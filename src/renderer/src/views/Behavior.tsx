import { Check, RotateCcw } from 'lucide-react'
import { PRESETS } from '@shared/defaults'
import type { Behavior as BehaviorSettings, PresetId } from '@shared/types'
import { api } from '../api'
import { Button, cn, Field, Page, PageHeader, SECONDS, Section, Segmented, Slider, StepSlider, Switch, TagInput } from '../components/ui'
import { useApp, useL } from '../store'

type L = (ru: string, en: string) => string

/** 45 → "45 с", 120 → "2 мин", 5400 → "1,5 ч". */
function span(sec: number, l: L): string {
  if (sec < 90) return l(`${sec} с`, `${sec} s`)
  if (sec < 5400) {
    const m = Math.round((sec / 60) * 2) / 2
    return l(`${String(m).replace('.', ',')} мин`, `${m} min`)
  }
  const h = Math.round((sec / 3600) * 10) / 10
  return l(`${String(h).replace('.', ',')} ч`, `${h} h`)
}

const PRESET_INFO: { id: PresetId; color: string; ru: string; en: string; ruText: string; enText: string }[] = [
  { id: 'rare', color: '#74c0fc', ru: 'Редко', en: 'Rarely', ruText: 'Пара реплик за стрим. Почти незаметно.', enText: 'A couple of lines per stream. Barely noticed.' },
  { id: 'normal', color: '#63e6be', ru: 'Спокойно', en: 'Easy', ruText: 'Как зритель, который смотрит и иногда пишет.', enText: 'Like a viewer who watches and writes now and then.' },
  { id: 'active', color: '#f2b544', ru: 'Активно', en: 'Active', ruText: 'Постоянно в разговоре, но не на каждое сообщение.', enText: 'Always in the conversation, but not on every message.' },
  { id: 'turbo', color: '#ff7a7a', ru: 'Жёстко', en: 'Full on', ruText: 'Пишет очень часто. В тихом чате это заметят, модераторы тоже.', enText: 'Writes very often. A quiet chat will notice, and so will the moderators.' }
]

export function Behavior() {
  const l = useL()
  const b = useApp((s) => s.settings!.behavior)
  const anonymous = useApp((s) => !s.auth?.canChat)
  const patch = useApp((s) => s.patch)
  const set = (behavior: Partial<BehaviorSettings>): void => patch({ behavior })
  // Moving a pace slider leaves the presets behind.
  const pace = (behavior: Partial<BehaviorSettings>): void => set({ ...behavior, preset: 'custom' })
  const times = (v: number): string => (v === 1 ? l('как всем', 'like the rest') : l(`в ${String(v).replace('.', ',')} раза чаще`, `${v}× as often`))

  return (
    <Page>
      <PageHeader title={l('Поведение', 'Behavior')} description={l('Когда отвечать, кому и как быстро. Всё применяется сразу, перезапуск не нужен.', 'When to answer, whom, and how fast. Everything applies at once; no restart is needed.')}>
        <Button variant="ghost" size="sm" onClick={() => void api.settings.reset('behavior').then((s) => useApp.setState({ settings: s }))}>
          <RotateCcw size={14} aria-hidden />
          {l('Вернуть как было', 'Reset')}
        </Button>
      </PageHeader>

      <Section title={l('Как часто', 'How often')} description={l('После каждого ответа Brackets делает паузу случайной длины, а потом отвечает на одно из ближайших сообщений. Поэтому ответы идут неровно, как у человека.', 'After each reply Brackets pauses for a random time, then answers one of the next messages. That keeps the replies uneven, the way a person writes.')}>
        <div className="grid grid-cols-2 gap-2.5">
          {PRESET_INFO.map((p) => {
            const active = b.preset === p.id
            const v = PRESETS[p.id]
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set({ preset: p.id, ...v })}
                className={cn('relative overflow-hidden rounded-xl border py-3 pr-3.5 pl-[18px] text-left transition-colors', active ? 'border-petal bg-petal-soft' : 'border-line bg-surface hover:border-line-strong')}
              >
                <span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: p.color }} aria-hidden />
                <span className="flex items-baseline justify-between gap-3">
                  <span className="display text-[1.2rem] font-semibold text-text">{l(p.ru, p.en)}</span>
                  <span className="num text-[0.98rem] text-text-2">
                    {span(v.minGapSec, l)} – {span(v.maxGapSec, l)}
                  </span>
                </span>
                <span className="mt-1 flex items-end justify-between gap-3">
                  <span className="text-[0.84rem] leading-snug text-text-2">{l(p.ruText, p.enText)}</span>
                  {active && <Check size={15} className="shrink-0 text-petal" aria-hidden />}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3">
          <StepSlider label={l('Пауза после ответа: от', 'Pause after a reply: from')} value={b.minGapSec} steps={SECONDS} onChange={(v) => pace({ minGapSec: v, maxGapSec: Math.max(v, b.maxGapSec) })} format={(v) => span(v, l)} />
          <StepSlider label={l('Пауза после ответа: до', 'Pause after a reply: up to')} value={b.maxGapSec} steps={SECONDS} onChange={(v) => pace({ maxGapSec: v, minGapSec: Math.min(v, b.minGapSec) })} format={(v) => span(v, l)} />
          <Slider label={l('Не больше ответов в час', 'No more replies per hour than')} value={b.maxPerHour} min={1} max={150} onChange={(v) => pace({ maxPerHour: v })} />
          <Slider
            label={l('Выбирать сообщение в течение', 'Pick a message within')}
            hint={l('Когда пауза закончилась, ответ достаётся не первому же сообщению, а одному из тех, что придут примерно за это время.', 'Once the pause is over, the reply does not go to the very first message but to one of those that arrive within about this long.')}
            value={b.spreadSec}
            min={3}
            max={120}
            onChange={(spreadSec) => set({ spreadSec })}
            format={(v) => span(v, l)}
          />
        </div>
      </Section>

      <Section title={l('На что отвечать охотнее', 'What gets an answer sooner')}>
        <Switch checked={b.replyToMentions} onChange={(replyToMentions) => set({ replyToMentions })} label={l('Отвечать, когда обращаются ко мне', 'Answer when someone talks to me')} description={l('Если в сообщении твой ник или это ответ на твоё сообщение, Brackets отвечает, не дожидаясь конца паузы.', 'When a message has your name in it or replies to yours, Brackets answers without waiting for the pause to end.')} />
        {b.replyToMentions && <Slider label={l('Между ответами на обращения не меньше', 'At least this long between answers to mentions')} value={b.mentionGapSec} min={2} max={120} onChange={(mentionGapSec) => set({ mentionGapSec })} format={(v) => span(v, l)} />}
        <Field label={l('Как ещё тебя называют', 'Other names people call you')} hint={l('Сокращения ника или имя. Сообщение с таким словом считается обращением к тебе.', 'Short forms of your name. A message with one of these counts as talking to you.')}>
          <TagInput ariaLabel={l('Как ещё тебя называют', 'Other names people call you')} values={b.aliases} onChange={(aliases) => set({ aliases })} placeholder={l('имя и Enter', 'a name, then Enter')} />
        </Field>
        <Slider label={l('Вопросы', 'Questions')} value={b.questionBoost} min={1} max={5} step={0.5} onChange={(questionBoost) => set({ questionBoost })} format={times} />
        <Slider label={l('Сообщения стримера', 'Messages from the streamer')} value={b.streamerBoost} min={1} max={5} step={0.5} onChange={(streamerBoost) => set({ streamerBoost })} format={times} />
        <Field label={l('Любимые темы', 'Favourite topics')} hint={l('Слова, на которые ты бы и сам отозвался: игра, персонаж, мем.', 'Words you would react to yourself: a game, a character, a meme.')}>
          <TagInput ariaLabel={l('Любимые темы', 'Favourite topics')} values={b.keywords} onChange={(keywords) => set({ keywords })} placeholder={l('слово и Enter', 'a word, then Enter')} />
        </Field>
        {b.keywords.length > 0 && <Slider label={l('Сообщения на эти темы', 'Messages on these topics')} value={b.keywordBoost} min={1} max={5} step={0.5} onChange={(keywordBoost) => set({ keywordBoost })} format={times} />}
      </Section>

      <Section title={l('Что пропускать', 'What to leave alone')} description={l('Известные чат-боты (Nightbot, StreamElements и другие) пропускаются всегда.', 'Well-known chat bots (Nightbot, StreamElements and others) are always skipped.')}>
        <Switch checked={b.skipDirected} onChange={(skipDirected) => set({ skipDirected })} label={l('Чужие разговоры', 'Other people’s conversations')} description={l('Сообщения, которые начинаются с @другого_ника, и ответы другим людям.', 'Messages that open with @someone_else, and replies to other people.')} />
        <Switch checked={b.ignoreCommands} onChange={(ignoreCommands) => set({ ignoreCommands })} label={l('Команды', 'Commands')} description={l('Всё, что начинается с «!» или «/».', 'Anything that starts with "!" or "/".')} />
        <Switch checked={b.ignoreLinks} onChange={(ignoreLinks) => set({ ignoreLinks })} label={l('Сообщения со ссылками', 'Messages with links')} />
        <Field label={l('Кому не отвечать', 'People not to answer')}>
          <TagInput ariaLabel={l('Кому не отвечать', 'People not to answer')} values={b.ignoreUsers} onChange={(ignoreUsers) => set({ ignoreUsers })} placeholder={l('ник и Enter', 'a name, then Enter')} />
        </Field>
        <Slider label={l('Одному и тому же человеку не чаще, чем раз в', 'The same person no more often than every')} value={b.userCooldownSec} min={0} max={900} step={10} onChange={(userCooldownSec) => set({ userCooldownSec })} format={(v) => (v === 0 ? l('без ограничения', 'no limit') : span(v, l))} />
        <Slider label={l('Самое короткое сообщение, на которое стоит отвечать', 'The shortest message worth answering')} value={b.minChars} min={1} max={20} onChange={(minChars) => set({ minChars })} format={(v) => l(`${v} букв`, `${v} letters`)} />
      </Section>

      <Section title={l('Как отвечать', 'How to answer')}>
        <Field
          label={l('Вид ответа', 'What a reply looks like')}
          hint={
            b.replyMode === 'auto'
              ? l('Обычная реплика в чат; если обращались к тебе, то ответом Twitch на то сообщение.', 'A plain line in chat; when someone talked to you, a Twitch reply to that message.')
              : b.replyMode === 'plain'
                ? l('Всегда обычная реплика, без имени.', 'Always a plain line, with no name.')
                : b.replyMode === 'mention'
                  ? l('Всегда начинается с @ника того, кому отвечаешь.', 'Always opens with the @name of the person you answer.')
                  : l('Всегда ответом Twitch: над сообщением видно, на что оно отвечает.', 'Always a Twitch reply: the message shows what it answers.')
          }
        >
          <Segmented
            label={l('Вид ответа', 'What a reply looks like')}
            value={b.replyMode}
            options={[
              { value: 'auto', label: l('Само', 'Auto') },
              { value: 'plain', label: l('Просто в чат', 'Plain') },
              { value: 'mention', label: l('Через @ник', 'With @name') },
              { value: 'thread', label: l('Ответом Twitch', 'Twitch reply') }
            ]}
            onChange={(replyMode) => set({ replyMode })}
          />
        </Field>
        <Field label={l('Скорость набора', 'Typing speed')} hint={l('Сколько проходит между сообщением и ответом. Мгновенный ответ из трёх предложений выдаёт программу.', 'How long passes between a message and the reply. A three-sentence answer that lands instantly gives a program away.')}>
          <Segmented
            label={l('Скорость набора', 'Typing speed')}
            value={b.typing}
            options={[
              { value: 'instant', label: l('Сразу', 'At once') },
              { value: 'fast', label: l('Быстро', 'Fast') },
              { value: 'human', label: l('Как человек', 'Like a person') },
              { value: 'slow', label: l('Не спеша', 'Slowly') }
            ]}
            onChange={(typing) => set({ typing })}
          />
        </Field>
        <Slider label={l('Не отправлять, если опоздал больше чем на', 'Do not send when later than')} hint={l('Нейросеть иногда думает долго. Ответ на сообщение, которое уже уехало вверх, выглядит странно.', 'The model is sometimes slow. A reply to a message that has scrolled away looks odd.')} value={b.maxStaleSec} min={10} max={180} step={5} onChange={(maxStaleSec) => set({ maxStaleSec })} format={(v) => span(v, l)} />
        <Slider label={l('Сколько последних сообщений читать перед ответом', 'How many recent messages to read before answering')} value={b.contextSize} min={0} max={40} onChange={(contextSize) => set({ contextSize })} />
        <Slider label={l('Самый длинный ответ', 'The longest reply')} value={b.maxChars} min={20} max={450} step={10} onChange={(maxChars) => set({ maxChars })} format={(v) => l(`${v} символов`, `${v} characters`)} />
      </Section>

      <Section title={l('Осторожность', 'Caution')}>
        <Switch
          checked={b.test || anonymous}
          disabled={anonymous}
          onChange={(test) => set({ test })}
          label={l('Тестовый режим', 'Test mode')}
          description={anonymous ? l('Включён сам: без входа в Twitch отправлять нечем.', 'On by itself: without a Twitch sign-in there is nothing to send with.') : l('Ответы пишутся и видны на «Мониторе», но в чат не уходят. Удобно, чтобы проверить стиль на живом чате.', 'Replies are written and shown on the Monitor, but do not go to chat. Handy for checking the style on a live chat.')}
        />
        <Slider label={l('Молчать, когда я пишу сам', 'Stay quiet when I type myself')} hint={l('Если ты написал в чат с этого аккаунта, Brackets замолкает на это время, чтобы вы не говорили хором.', 'When you write in chat from this account, Brackets goes quiet for this long, so the two of you do not talk over each other.')} value={b.pauseWhenITalkMin} min={0} max={30} onChange={(pauseWhenITalkMin) => set({ pauseWhenITalkMin })} format={(v) => (v === 0 ? l('не молчать', 'never') : l(`${v} мин`, `${v} min`))} />
        <Field label={l('Стоп-слова', 'Blocked words')} hint={l('На сообщение с таким словом ответа не будет, и свой ответ с ним Brackets не отправит.', 'A message with one of these gets no answer, and Brackets will not send a reply that has one.')}>
          <TagInput ariaLabel={l('Стоп-слова', 'Blocked words')} values={b.blocked} onChange={(blocked) => set({ blocked })} placeholder={l('слово и Enter', 'a word, then Enter')} />
        </Field>
        <Switch checked={b.onlyWhenLive} onChange={(onlyWhenLive) => set({ onlyWhenLive })} label={l('Только пока идёт стрим', 'Only while the stream is live')} description={l('Узнать это можно только после входа в Twitch.', 'This can only be told after signing in to Twitch.')} />
        <Slider label={l('Остановиться самому через', 'Stop by itself after')} value={b.autoStopHours} min={0} max={24} onChange={(autoStopHours) => set({ autoStopHours })} format={(v) => (v === 0 ? l('не останавливаться', 'never') : l(`${v} ч`, `${v} h`))} />
      </Section>
    </Page>
  )
}
