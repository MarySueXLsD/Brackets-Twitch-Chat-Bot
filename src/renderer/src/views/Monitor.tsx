import { ArrowDown, Check, CornerDownRight, FlaskConical, Play, Send, Square, Trash2 } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { normalizeChannel } from '@core/irc'
import type { BotStatus, DecisionEntry, FeedItem, PauseReason, ReplyItem, Trigger } from '@shared/types'
import { mix, luminance } from '@shared/themes'
import { api } from '../api'
import { Rhythm } from '../components/Rhythm'
import { Button, Chip, cn, Segmented, Spinner } from '../components/ui'
import { useApp, useL } from '../store'

type L = (ru: string, en: string) => string

const clock = (ts: number): string => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const mmss = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Re-render once a second while something on screen counts down. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [active])
  return now
}

const TRIGGER: Record<Trigger, [string, string]> = {
  mention: ['обращение', 'mention'],
  question: ['вопрос', 'question'],
  keyword: ['ключевое слово', 'keyword'],
  streamer: ['стример', 'streamer'],
  chat: ['чат', 'chat']
}

const OUTCOME: Record<DecisionEntry['outcome'], [string, string]> = {
  reply: ['ответил', 'replied'],
  chance: ['не выбрано', 'not picked'],
  user_cooldown: ['этому человеку отвечал недавно', 'answered this person recently'],
  hour_cap: ['лимит ответов в час', 'hourly limit reached'],
  mention_cooldown: ['только что отвечал на обращение', 'just answered a mention'],
  blocked_word: ['стоп-слово в сообщении', 'blocked word in the message'],
  offline_stream: ['стрим не в эфире', 'the stream is offline'],
  stale: ['опоздал с ответом', 'the reply came too late'],
  no_pick: ['ни одно сообщение не подошло', 'no message was fit to answer'],
  empty: ['модель ничего не написала', 'the model wrote nothing'],
  nothing: ['модель решила, что ответить нечего', 'the model found nothing to say'],
  garbled: ['модель выдала бессвязный текст', 'the model wrote gibberish'],
  thinking: ['модель начала рассуждать вслух', 'the model thought out loud'],
  off_language: ['модель ответила не на том языке', 'the model answered in the wrong language'],
  refusal: ['модель ответила как ассистент', 'the model answered like an assistant'],
  blocked: ['стоп-слово в ответе', 'blocked word in the reply'],
  link: ['ссылка в ответе', 'link in the reply'],
  repeat: ['такой ответ уже был', 'the same reply was used already'],
  llm_error: ['модель не ответила', 'the model did not answer'],
  paused: ['пауза', 'on hold'],
  rejected: ['не удалось отправить', 'could not be sent'],
  stopped: ['остановлено', 'stopped'],
  // These never reach the list; they are here so every outcome has words.
  self: ['своё сообщение', 'own message'],
  ignored_user: ['бот или игнор', 'bot or ignored'],
  command: ['команда', 'command'],
  short: ['слишком короткое', 'too short'],
  emote_only: ['только эмоуты', 'emotes only'],
  copypaste: ['чат повторяет одно и то же', 'the chat is repeating one line'],
  bot_question: ['спрашивают, не бот ли ты: ответь сам', 'asked whether you are a bot: yours to answer'],
  directed: ['адресовано другому', 'addressed to someone else'],
  cooldown: ['пауза после ответа', 'pause after a reply'],
  busy: ['уже пишет ответ', 'already writing']
}

const PAUSE: Record<PauseReason, [string, string]> = {
  you_typed: ['ты пишешь сам', 'you are typing yourself'],
  timeout: ['тайм-аут в чате', 'timed out in chat'],
  banned: ['бан в чате', 'banned from chat'],
  room: ['чат закрыт для сообщений', 'the chat is restricted'],
  auto_stop: ['авто-стоп', 'auto-stop'],
  not_live: ['стрим не в эфире', 'the stream is offline']
}

// Names with no colour of their own get one from this row, picked by the name.
const NAME_COLORS = ['#ff7a7a', '#ffa94d', '#ffd43b', '#8ce99a', '#63e6be', '#66d9e8', '#74c0fc', '#91a7ff', '#b197fc', '#e599f7', '#faa2c1']

function nameColor(color: string, login: string, dark: boolean): string {
  let c = color
  if (!c) {
    let hash = 0
    for (let i = 0; i < login.length; i++) hash = (hash * 31 + login.charCodeAt(i)) >>> 0
    c = NAME_COLORS[hash % NAME_COLORS.length]
  }
  // Twitch lets people pick colours that vanish on a dark or a light page; pull those back into view.
  const lum = luminance(c)
  if (dark && lum < 0.2) return mix(c, '#ffffff', 0.55)
  if (!dark && lum > 0.3) return mix(c, '#000000', lum > 0.55 ? 0.55 : 0.4)
  return c
}

// ------------------------------------------------------------------ the bar on top

function Readout({ value, unit, label, tone, title, className }: { value: ReactNode; unit?: string; label: string; tone?: 'live' | 'warn' | 'dim'; title?: string; className?: string }) {
  return (
    <div className={cn('flex shrink-0 flex-col justify-center', className)} title={title}>
      <span className={cn('num text-[1.75rem] leading-none whitespace-nowrap', tone === 'live' ? 'text-pollen' : tone === 'warn' ? 'text-danger' : tone === 'dim' ? 'text-text-3' : 'text-text')}>
        {value}
        {unit && <span className="ml-1 text-[0.85rem] text-text-3">{unit}</span>}
      </span>
      <span className="mt-1 text-[0.76rem] whitespace-nowrap text-text-3">{label}</span>
    </div>
  )
}

function NextReply({ s, l }: { s: BotStatus; l: L }) {
  const running = s.state === 'running'
  const now = useNow(running)
  if (!running) return <Readout value="—" label={l('следующий ответ', 'next reply')} tone="dim" />
  if (s.pausedUntil > now) {
    const why = s.pauseReason ? l(...PAUSE[s.pauseReason]) : l('пауза', 'on hold')
    return (
      <div className="flex items-center gap-3">
        <Readout value={mmss(s.pausedUntil - now)} label={why} tone="warn" />
        <Button size="sm" variant="ghost" className="no-drag" onClick={() => void api.bot.resume()}>
          {l('Снять', 'Resume')}
        </Button>
      </div>
    )
  }
  if (s.job) {
    const phase = s.job.phase === 'choosing' ? l('выбирает', 'choosing') : s.job.phase === 'reading' ? l('читает', 'reading') : s.job.phase === 'thinking' ? l('думает', 'thinking') : l('печатает', 'typing')
    return <Readout value={<span className="live">{phase}</span>} label={s.job.phase === 'choosing' ? l('на что ответить', 'what to answer') : l('пишет ответ', 'writing a reply')} />
  }
  if (s.nextWindowAt > now) return <Readout value={mmss(s.nextWindowAt - now)} label={l('пауза до ответа', 'pause before a reply')} />
  return <Readout value={l('ждёт', 'ready')} label={l('ответит на одно из ближайших', 'answers one of the next')} tone="live" />
}

function ChannelBox({ l }: { l: L }) {
  const channel = useApp((s) => s.settings?.twitch.channel ?? '')
  const patch = useApp((s) => s.patch)
  const [text, setText] = useState(channel)
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setText(channel)
  }, [channel])
  const commit = (): void => {
    editing.current = false
    const clean = normalizeChannel(text)
    setText(clean || channel)
    if (clean && clean !== normalizeChannel(channel)) patch({ twitch: { channel: clean } })
  }
  return (
    <label className="no-drag flex shrink-0 flex-col justify-center">
      <span className="flex items-baseline">
        <span className="display text-[1.5rem] leading-none text-text-3">#</span>
        <input
          spellCheck={false}
          aria-label={l('Канал', 'Channel')}
          className="display rounded bg-transparent px-0.5 text-[1.5rem] leading-none font-semibold text-text placeholder:font-normal placeholder:text-text-3 focus:bg-sunken focus:outline-none"
          style={{ width: `${Math.min(18, Math.max(6, text.length + 1.5))}ch` }}
          value={text}
          placeholder={l('канал', 'channel')}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </span>
      <span className="mt-1 text-[0.76rem] whitespace-nowrap text-text-3">{l('чей чат слушать', 'whose chat to sit in')}</span>
    </label>
  )
}

function Transport({ s, l }: { s: BotStatus; l: L }) {
  const patch = useApp((st) => st.patch)
  const testSetting = useApp((st) => st.settings?.behavior.test ?? false)
  const busy = s.state === 'starting'
  const on = s.state === 'running' || busy
  const count = s.test ? s.counters.tests : s.counters.replies
  return (
    <div className="drag flex h-[76px] shrink-0 items-center gap-6 border-b border-line pr-[150px] pl-5">
      <button
        type="button"
        onClick={() => void (on ? api.bot.stop() : api.bot.start())}
        className={cn(
          'no-drag display inline-flex h-12 w-[128px] shrink-0 items-center justify-center gap-2.5 rounded-xl text-[1.15rem] font-semibold tracking-wide transition-colors',
          on ? 'border border-line-strong bg-raised text-text hover:border-danger hover:text-danger' : 'glowable bg-petal-strong text-on-petal hover:bg-petal'
        )}
      >
        {busy ? <Spinner /> : on ? <Square size={15} fill="currentColor" aria-hidden /> : <Play size={17} fill="currentColor" aria-hidden />}
        {busy ? l('Запуск', 'Starting') : on ? l('Стоп', 'Stop') : l('Старт', 'Start')}
      </button>
      <ChannelBox l={l} />
      <div className="h-9 w-px shrink-0 bg-line" />
      <Readout value={s.state === 'running' ? s.perMin : '—'} unit={s.state === 'running' ? l('в мин', '/min') : undefined} label={l('темп чата', 'chat tempo')} tone={s.state === 'running' ? undefined : 'dim'} />
      <Readout className="max-[1180px]:hidden" value={count} label={s.test ? l('ответов написано', 'replies written') : l('ответов отправлено', 'replies sent')} tone={count ? undefined : 'dim'} />
      <NextReply s={s} l={l} />
      <span className="min-w-0 flex-1" />
      <Button
        size="sm"
        variant={testSetting ? 'subtle' : 'ghost'}
        className="no-drag"
        aria-pressed={testSetting}
        title={l('Тестовый режим: ответы пишутся и показываются здесь, но в чат не отправляются', 'Test mode: replies are written and shown here, but not sent to chat')}
        onClick={() => patch({ behavior: { test: !testSetting } })}
      >
        <FlaskConical size={14} className={testSetting ? 'text-pollen' : undefined} aria-hidden />
        {l('Тест', 'Test')}
      </Button>
    </div>
  )
}

// ------------------------------------------------------------------ the chat

const Row = memo(function Row({ item, dark, l, fresh }: { item: FeedItem; dark: boolean; l: L; fresh: boolean }) {
  if (item.type === 'note') {
    const dot = item.tone === 'ok' ? 'bg-ok' : item.tone === 'warn' ? 'bg-pollen' : item.tone === 'error' ? 'bg-danger' : 'bg-text-3'
    return (
      <div className="flex items-baseline gap-2.5 px-5 py-1.5 text-[0.84rem] text-text-2">
        <span className="num w-10 shrink-0 text-right text-[0.78rem] text-text-3">{clock(item.ts)}</span>
        <span className={cn('size-1.5 shrink-0 -translate-y-px rounded-full', dot)} aria-hidden />
        <span className={cn('selectable', item.tone === 'error' && 'text-danger')}>{l(item.ru, item.en)}</span>
      </div>
    )
  }
  if (item.type === 'reply') {
    const [ru, en] = (item.note ?? '|').split('|')
    return (
      <div className={cn('mx-3 my-1.5 rounded-lg border-l-[3px] bg-petal-soft py-2 pr-3 pl-3', item.status === 'rejected' ? 'border-danger' : 'border-petal', item.status === 'test' && 'border-dashed', fresh && 'hit')}>
        <div className="flex items-baseline gap-1.5 text-[0.8rem] text-text-3">
          <CornerDownRight size={12} className="shrink-0 translate-y-0.5" aria-hidden />
          <span className="font-medium text-text-2">{item.to.name}</span>
          <span className="truncate">{item.to.text}</span>
        </div>
        <div className="selectable mt-1 text-[1rem] leading-snug font-medium break-words text-text">{item.text}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {item.status === 'sent' && (
            <Chip tone="petal">
              <Check size={11} className="mr-1" aria-hidden />
              {l('отправлено', 'sent')}
            </Chip>
          )}
          {item.status === 'test' && <Chip tone="pollen">{l('тест, не отправлено', 'test, not sent')}</Chip>}
          {item.status === 'rejected' && <Chip tone="danger">{l(ru || 'Twitch не принял', en || 'Twitch refused it')}</Chip>}
          <Chip>{l(...TRIGGER[item.trigger])}</Chip>
          <span className="num truncate text-[0.8rem] text-text-3">
            {clock(item.ts)}
            {item.via && `  ${item.via}`}
            {item.ms > 0 && `  ${(item.ms / 1000).toFixed(1)} ${l('с', 's')}`}
          </span>
        </div>
      </div>
    )
  }
  const m = item.msg
  return (
    <div className={cn('flex items-baseline gap-2.5 px-5 py-[3px] text-[0.94rem] leading-snug', item.picked && 'bg-pollen-soft')}>
      <span className="num w-10 shrink-0 text-right text-[0.78rem] text-text-3">{clock(m.ts)}</span>
      <span className="min-w-0 break-words">
        <span className="font-semibold" style={{ color: nameColor(m.color, m.login, dark) }}>
          {m.name}
        </span>
        {m.broadcaster && <span className="ml-1.5 text-[0.72rem] text-text-3">{l('стример', 'streamer')}</span>}
        {m.mod && !m.broadcaster && <span className="ml-1.5 text-[0.72rem] text-text-3">{l('мод', 'mod')}</span>}
        {m.self && <span className="ml-1.5 text-[0.72rem] text-petal">{l('ты', 'you')}</span>}
        <span className="text-text-3">{m.action ? ' ' : ': '}</span>
        <span className={cn('selectable text-text', m.action && 'italic')}>{m.text}</span>
      </span>
    </div>
  )
})

function Checklist({ l }: { l: L }) {
  const setView = useApp((s) => s.setView)
  const channel = useApp((s) => normalizeChannel(s.settings?.twitch.channel ?? ''))
  const auth = useApp((s) => s.auth)
  const router = useApp((s) => s.router)
  const source = useApp((s) => s.settings?.llm.source ?? 'builtin')
  const modelReady = source === 'custom' || router?.state === 'ready'
  const rows: { ok: boolean; soft?: boolean; ru: string; en: string; go?: () => void; ruGo?: string; enGo?: string }[] = [
    { ok: Boolean(channel), ru: channel ? `Канал: ${channel}` : 'Впиши канал вверху, рядом с кнопкой «Старт»', en: channel ? `Channel: ${channel}` : 'Type the channel at the top, next to Start' },
    {
      ok: Boolean(auth?.canChat),
      soft: true,
      ru: auth?.signedIn ? (auth.canChat ? `Аккаунт: ${auth.login}` : `Аккаунт ${auth.login} не может писать в чат`) : 'Без входа в Twitch можно только смотреть: ответы пишутся, но не отправляются',
      en: auth?.signedIn ? (auth.canChat ? `Account: ${auth.login}` : `The account ${auth.login} may not write to chat`) : 'Without a Twitch sign-in you can only watch: replies are written but not sent',
      go: () => setView('account'),
      ruGo: 'Войти',
      enGo: 'Sign in'
    },
    {
      ok: modelReady,
      ru: modelReady ? 'Нейросеть готова' : router?.state === 'starting' ? 'Нейросеть запускается…' : 'Нейросеть не запущена',
      en: modelReady ? 'The model is ready' : router?.state === 'starting' ? 'The model is starting…' : 'The model is not running',
      go: () => setView('engine'),
      ruGo: 'Открыть',
      enGo: 'Open'
    }
  ]
  return (
    <div className="flex h-full flex-col items-start justify-center px-12">
      <h2 className="display text-[2.1rem] leading-tight font-semibold text-text">{l('Чат появится здесь', 'The chat will show up here')}</h2>
      <p className="mt-2 max-w-[52ch] text-[0.95rem] leading-relaxed text-text-2">
        {l('Нажми «Старт», и Brackets сядет в чат: будет читать сообщения и время от времени отвечать в твоей манере. Окно можно свернуть, он продолжит работать.', 'Press Start and Brackets sits in the chat: it reads the messages and answers now and then in your manner. You can hide the window; it keeps working.')}
      </p>
      <ul className="mt-6 flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.en} className="flex max-w-[58ch] items-center gap-3 text-[0.93rem]">
            <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full', r.ok ? 'bg-ok-soft text-ok' : r.soft ? 'bg-pollen-soft text-pollen' : 'bg-sunken text-text-3')} aria-hidden>
              {r.ok ? <Check size={12} /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <span className={r.ok ? 'text-text' : 'text-text-2'}>{l(r.ru, r.en)}</span>
            {!r.ok && r.go && (
              <Button size="sm" variant="subtle" className="h-7 px-2.5" onClick={r.go}>
                {l(r.ruGo ?? '', r.enGo ?? '')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Feed({ l, running }: { l: L; running: boolean }) {
  const feed = useApp((s) => s.feed)
  const dark = useApp((s) => document.documentElement.dataset.theme !== 'light' || !s.settings)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [away, setAway] = useState(false)
  const mounted = useRef(Date.now())

  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [feed])

  if (!feed.length && !running) return <Checklist l={l} />
  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={box}
        className="h-full overflow-y-auto py-2"
        onScroll={(e) => {
          const el = e.currentTarget
          const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          stick.current = atEnd
          setAway(!atEnd)
        }}
      >
        {!feed.length && <div className="px-5 py-3 text-[0.9rem] text-text-3">{l('Жду первое сообщение в чате…', 'Waiting for the first chat message…')}</div>}
        {feed.map((item) => (
          <Row key={item.id} item={item} dark={dark} l={l} fresh={item.type === 'reply' && item.ts > mounted.current} />
        ))}
      </div>
      {away && (
        <button
          type="button"
          className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3.5 text-[0.84rem] text-text shadow-float hover:bg-petal-soft"
          onClick={() => {
            const el = box.current
            if (el) el.scrollTop = el.scrollHeight
          }}
        >
          <ArrowDown size={13} aria-hidden />
          {l('К новым сообщениям', 'Jump to the newest')}
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ the side panel

function NowCard({ s, l }: { s: BotStatus; l: L }) {
  const job = s.job
  const now = useNow(Boolean(job?.sendAt))
  if (s.state !== 'running') return <p className="text-[0.88rem] leading-relaxed text-text-3">{s.state === 'error' && s.error ? <span className="text-danger">{l(s.error.ru, s.error.en)}</span> : l('Остановлено. Нажми «Старт».', 'Stopped. Press Start.')}</p>
  if (!job) return <p className="text-[0.88rem] leading-relaxed text-text-3">{l('Читает чат и ждёт подходящий момент.', 'Reading the chat and waiting for the right moment.')}</p>
  if (job.phase === 'choosing') {
    return (
      <div>
        <div className="live text-[0.98rem] font-medium">{l('выбирает, на что ответить…', 'choosing what to answer…')}</div>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-text-3">{l(`Смотрит последние сообщения (${job.pool ?? 0}) и ищет то, на которое можно ответить в общих словах.`, `Looking over the latest messages (${job.pool ?? 0}) for one that can be answered in general terms.`)}</p>
      </div>
    )
  }
  const total = job.sendAt ? Math.max(1, job.sendAt - job.startedAt) : 0
  const done = job.sendAt ? Math.min(1, (now - job.startedAt) / total) : 0
  return (
    <div>
      <div className="flex items-baseline gap-1.5 text-[0.82rem] text-text-3">
        <CornerDownRight size={12} className="shrink-0 translate-y-0.5" aria-hidden />
        <span className="font-medium text-text-2">{job.to.name}</span>
        <span className="truncate">{job.to.text}</span>
      </div>
      {job.text ? <div className="selectable mt-1.5 text-[0.98rem] leading-snug font-medium break-words text-text">{job.text}</div> : <div className="live mt-1.5 text-[0.98rem] font-medium">{job.phase === 'reading' ? l('читает сообщение…', 'reading the message…') : l('придумывает ответ…', 'thinking of a reply…')}</div>}
      {job.sendAt && (
        <div className="mt-2.5">
          <div className="h-1 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-pollen transition-[width] duration-500 ease-linear" style={{ width: `${done * 100}%` }} />
          </div>
          <div className="mt-1 text-[0.76rem] text-text-3">{l(`печатает, отправит через ${mmss(job.sendAt - now)}`, `typing, sends in ${mmss(job.sendAt - now)}`)}</div>
        </div>
      )}
    </div>
  )
}

function ReplyCard({ r, l }: { r: ReplyItem; l: L }) {
  const [ru, en] = (r.note ?? '|').split('|')
  return (
    <div className={cn('rounded-lg border-l-[3px] bg-petal-soft py-2 pr-2.5 pl-2.5', r.status === 'rejected' ? 'border-danger' : 'border-petal', r.status === 'test' && 'border-dashed')}>
      <div className="flex items-baseline gap-1.5 text-[0.78rem] text-text-3">
        <span className="shrink-0 font-medium text-text-2">{r.to.name}</span>
        <span className="truncate">{r.to.text}</span>
      </div>
      <div className="selectable mt-0.5 text-[0.95rem] leading-snug font-medium break-words text-text">{r.text}</div>
      <div className="mt-1 flex items-center gap-1.5">
        {r.status === 'rejected' && <Chip tone="danger">{l(ru || 'Twitch не принял', en || 'Twitch refused it')}</Chip>}
        {r.status === 'test' && <Chip tone="pollen">{l('тест', 'test')}</Chip>}
        <Chip>{l(...TRIGGER[r.trigger])}</Chip>
        <span className="num min-w-0 truncate text-[0.78rem] text-text-3" title={r.via}>
          {clock(r.ts)}
          {r.ms > 0 && `  ${(r.ms / 1000).toFixed(1)} ${l('с', 's')}`}
          {r.via && `  ${r.via.split('/').pop()}`}
        </span>
      </div>
    </div>
  )
}

function Side({ s, l }: { s: BotStatus; l: L }) {
  const replies = useApp((st) => st.replies)
  const decisions = useApp((st) => st.decisions)
  const [tab, setTab] = useState<'replies' | 'decisions'>('replies')
  const shownReplies = replies.slice(-40).reverse()
  const shownDecisions = decisions.slice(-60).reverse()
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="border-b border-line px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="display text-[1.02rem] font-semibold text-text">{l('Сейчас', 'Right now')}</h3>
          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={s.state !== 'running' || s.job !== null} title={l('Ответить на последнее подходящее сообщение, не дожидаясь паузы', 'Answer the latest fitting message without waiting for the pause')} onClick={() => void api.bot.replyNow()}>
            <Send size={13} aria-hidden />
            {l('Ответить сейчас', 'Reply now')}
          </Button>
        </div>
        <div className="mt-1.5">
          <NowCard s={s} l={l} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <Segmented
            size="sm"
            label={l('Что показать', 'What to show')}
            value={tab}
            options={[
              { value: 'replies', label: l(`Ответы ${replies.length || ''}`.trim(), `Replies ${replies.length || ''}`.trim()) },
              { value: 'decisions', label: l('Решения', 'Decisions') }
            ]}
            onChange={setTab}
          />
          <span className="num text-[0.8rem] text-text-3" title={l('Увидел сообщений / начал, но не отправил ответов', 'Messages seen / replies started but not sent')}>
            {s.counters.seen} / {s.counters.dropped}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
          {tab === 'replies' ? (
            <div className="flex flex-col gap-1.5">
              {!shownReplies.length && <p className="px-1.5 py-2 text-[0.86rem] leading-relaxed text-text-3">{l('Здесь собираются ответы. В быстром чате они улетают из ленты за минуту, а тут остаются.', 'The replies gather here. In a fast chat they leave the feed within a minute; here they stay.')}</p>}
              {shownReplies.map((r) => (
                <ReplyCard key={r.id} r={r} l={l} />
              ))}
            </div>
          ) : (
            <>
              {!shownDecisions.length && <p className="px-1.5 py-2 text-[0.86rem] leading-relaxed text-text-3">{l('Здесь видно, почему на одно сообщение ответ был, а на другое нет.', 'This shows why one message got an answer and another did not.')}</p>}
              {shownDecisions.map((d) => {
                const replied = d.outcome === 'reply'
                return (
                  <div key={d.id} className="rounded-md px-1.5 py-1.5 hover:bg-sunken" title={d.detail && !replied ? d.detail : undefined}>
                    <div className="flex items-center gap-1.5 text-[0.8rem]">
                      <span className={cn('size-1.5 shrink-0 rounded-full', replied ? 'bg-petal' : d.outcome === 'chance' ? 'bg-text-3' : 'bg-pollen')} aria-hidden />
                      <span className={cn('truncate font-medium', replied ? 'text-text' : 'text-text-2')}>
                        {l(...OUTCOME[d.outcome])}
                        {d.outcome === 'chance' && d.chance !== undefined && `, ${l('шанс', 'chance')} ${Math.round(d.chance * 100)}%`}
                        {d.outcome === 'no_pick' && d.detail && `, ${l('из', 'out of')} ${Number.parseInt(d.detail, 10) || 0}`}
                      </span>
                      <span className="min-w-0 flex-1" />
                      <span className="shrink-0 text-text-3">{l(...TRIGGER[d.trigger])}</span>
                      <span className="num shrink-0 text-[0.78rem] text-text-3">{clock(d.ts)}</span>
                    </div>
                    {d.name && (
                      <div className="mt-0.5 truncate pl-3 text-[0.82rem] text-text-3">
                        <span className="text-text-2">{d.name}</span>: {d.text}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-[0.8rem] text-text-3">
        <span className="num truncate" title={s.llm.lastError || undefined}>
          {s.llm.avgMs ? l(`модель: в среднем ${(s.llm.avgMs / 1000).toFixed(1)} с`, `model: ${(s.llm.avgMs / 1000).toFixed(1)} s on average`) : l('модель ещё не отвечала', 'the model has not answered yet')}
          {s.llm.errors > 0 && <span className="text-danger">{l(`, ошибок: ${s.llm.errors}`, `, errors: ${s.llm.errors}`)}</span>}
        </span>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-sunken hover:text-text"
          title={l('Очистить ленту, ответы и решения', 'Clear the feed, the replies and the decisions')}
          onClick={() => {
            void api.bot.clearFeed()
            useApp.setState({ feed: [], replies: [], decisions: [] })
          }}
        >
          <Trash2 size={12} aria-hidden />
          {l('Очистить', 'Clear')}
        </button>
      </div>
    </aside>
  )
}

export function Monitor() {
  const l = useL()
  const s = useApp((st) => st.status)
  const stripMin = useApp((st) => st.settings?.ui.stripMin ?? 5)
  const patch = useApp((st) => st.patch)
  if (!s) return null
  return (
    <div className="flex h-full flex-col">
      <Transport s={s} l={l} />
      <div className="relative shrink-0 border-b border-line bg-surface">
        <Rhythm spanMin={stripMin} />
        <div className="absolute top-1.5 left-3">
          <Segmented
            size="sm"
            label={l('Сколько минут показывать', 'Minutes shown')}
            value={String(stripMin) as '2' | '5' | '15'}
            options={[
              { value: '2', label: l('2 мин', '2 min') },
              { value: '5', label: l('5 мин', '5 min') },
              { value: '15', label: l('15 мин', '15 min') }
            ]}
            onChange={(v) => patch({ ui: { stripMin: Number(v) as 2 | 5 | 15 } })}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <Feed l={l} running={s.state === 'running' || s.state === 'starting'} />
        <Side s={s} l={l} />
      </div>
    </div>
  )
}
