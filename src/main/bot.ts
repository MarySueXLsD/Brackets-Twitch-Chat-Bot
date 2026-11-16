// The responder itself: it sits in a chat, decides which messages to answer (src/core/pacer.ts),
// has a model write the answer in the person's manner (src/core/persona.ts), cleans it up
// (src/core/filters.ts) and sends it after the time a person would need to type it.
import { powerSaveBlocker } from 'electron'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { COMMON_EMOTES } from '@shared/defaults'
import type { AuthStatus, Behavior, BotEvent, BotSnapshot, BotStatus, Beat, ChatMessage, Decision, DecisionEntry, DropReason, FeedItem, Job, Lang, LlmSample, PauseReason, ReplyItem, SkipReason, Trigger } from '@shared/types'
import { normalizeChannel } from '@core/irc'
import { addBrackets, dedupeKey, hasLink, isReaction, sanitizeReply, wordLetters } from '@core/filters'
import { ineligible, classify, Pacer, typingDelay } from '@core/pacer'
import { buildPrompt, detectLang, type ChatPrompt, type PromptLine } from '@core/persona'
import type { Store } from './store'
import { streamInfo } from './twitch/auth'
import { explainNotice } from './twitch/chat'
import { chat as askModel, LlmError, type ChatArgs, type ChatResult } from './llm'
import type { Router } from './router'

/** What the responder needs from a chat connection. TwitchChat is the real one; the demo has its own. */
export interface ChatSource {
  privileged: boolean
  connect(login: string, token: string, channel: string): void
  disconnect(): void
  say(text: string, replyToId?: string): boolean
  on(event: 'state', cb: (state: BotStatus['twitch']) => void): unknown
  on(event: 'joined', cb: (channel: string) => void): unknown
  on(event: 'message', cb: (message: ChatMessage) => void): unknown
  on(event: 'room', cb: (room: BotStatus['room']) => void): unknown
  on(event: 'notice', cb: (notice: { id: string; text: string }) => void): unknown
  on(event: 'punished', cb: (seconds: number) => void): unknown
  on(event: 'authfail', cb: () => void): unknown
}
/** What it needs from the sign-in. */
export interface Account {
  token(): Promise<string>
  status(): AuthStatus
  rejected(): Promise<string>
}
/** Something that writes a reply. `target` is the message being answered, for the scripted demo. */
export type Model = (args: ChatArgs & { target?: string }) => Promise<ChatResult>

/** A made-up chat for showing the app without Twitch or a model (src/main/demo.ts). */
export interface DemoScene {
  stream: { title: string; game: string; viewers: number }
  /** The messages the scripted model has an answer for. */
  scripted: (text: string) => boolean
}

/** Past activity to start a demo with, so the window is not empty in its first second. */
export interface Seed {
  feed: FeedItem[]
  decisions: DecisionEntry[]
  beats: Beat[]
  history: ChatMessage[]
  arrivals: number[]
  counters: BotStatus['counters']
  llm: BotStatus['llm']
  nextWindowAt: number
}

const FEED_MAX = 400
const REPLIES_MAX = 100
const DECISIONS_MAX = 120
const BEATS_MAX = 4000
const HISTORY_MAX = 60

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** Skips shown in the decision list. The rest happen on almost every message and would bury it. */
const WORTH_SHOWING: SkipReason[] = ['chance', 'user_cooldown', 'hour_cap', 'mention_cooldown', 'blocked_word', 'offline_stream', 'bot_question']

const freshStatus = (): BotStatus => ({
  state: 'idle',
  test: false,
  anonymous: true,
  channel: '',
  login: '',
  twitch: 'offline',
  room: { slow: 0, followersOnly: -1, subsOnly: false, emoteOnly: false },
  stream: { known: false, live: false, title: '', game: '', viewers: 0 },
  startedAt: 0,
  counters: { seen: 0, replies: 0, tests: 0, dropped: 0 },
  perMin: 0,
  nextWindowAt: 0,
  pausedUntil: 0,
  job: null,
  llm: { lastVia: '', lastMs: 0, avgMs: 0, errors: 0, lastError: '' }
})

export class Bot extends EventEmitter {
  private store: Store
  private auth: Account
  private router: Router
  private chat: ChatSource
  private model: Model
  private demo: DemoScene | null
  private status: BotStatus = freshStatus()
  private feed: FeedItem[] = []
  private replies: ReplyItem[] = []
  private decisions: DecisionEntry[] = []
  private beats: Beat[] = []
  private history: ChatMessage[] = []
  private ownLines = new Set<string>()
  private pacer = new Pacer()
  private recent: string[] = []
  private arrivals: number[] = []
  /** Goes up on every start and stop; a reply that was begun under an older number is abandoned. */
  private epoch = 0
  private queue: BotEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private tick: NodeJS.Timeout | null = null
  private streamTimer: NodeJS.Timeout | null = null
  private blocker: number | null = null
  private lastSend: { item: ReplyItem; at: number } | null = null
  private latencies: number[] = []
  private token = ''
  private learnTimer: NodeJS.Timeout | null = null
  private retriedAuth = false

  constructor(store: Store, auth: Account, router: Router, chat: ChatSource, options: { model?: Model; demo?: DemoScene } = {}) {
    super()
    this.store = store
    this.auth = auth
    this.router = router
    this.chat = chat
    this.model = options.model ?? askModel
    this.demo = options.demo ?? null
    chat.on('state', (s) => {
      this.status.twitch = s
      if (s === 'reconnecting' && this.status.state === 'running') this.note('warn', 'Связь с чатом пропала, переподключаюсь', 'Lost the chat connection, reconnecting')
      this.pushStatus()
    })
    chat.on('joined', (channel) => this.onJoined(channel))
    chat.on('message', (m) => this.onMessage(m))
    chat.on('room', (room) => {
      this.status.room = room
      this.pushStatus()
    })
    chat.on('notice', (n) => this.onNotice(n.id, n.text))
    chat.on('punished', (seconds) => this.onPunished(seconds))
    chat.on('authfail', () => void this.onAuthFail())
  }

  // ------------------------------------------------------------------ what the window sees

  snapshot(): BotSnapshot {
    this.refreshRate()
    return { status: this.publicStatus(), feed: this.feed, replies: this.replies, decisions: this.decisions, beats: this.beats }
  }

  private publicStatus(): BotStatus {
    return { ...this.status, nextWindowAt: this.pacer.nextWindowAt, counters: { ...this.status.counters }, llm: { ...this.status.llm } }
  }

  private push(event: BotEvent): void {
    // Only the newest status matters.
    if (event.e === 'status') this.queue = this.queue.filter((q) => q.e !== 'status')
    this.queue.push(event)
    if (this.flushTimer) return
    // A fast chat sends dozens of lines a second; the window gets them in small batches.
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      const batch = this.queue
      this.queue = []
      if (batch.length) this.emit('events', batch)
    }, 120)
  }

  private pushStatus(): void {
    this.push({ e: 'status', s: this.publicStatus() })
  }

  private addFeed(item: FeedItem): void {
    const at = this.feed.findIndex((f) => f.id === item.id)
    if (at >= 0) this.feed[at] = item
    else {
      this.feed.push(item)
      if (this.feed.length > FEED_MAX) this.feed.splice(0, this.feed.length - FEED_MAX)
    }
    if (item.type === 'reply') {
      const r = this.replies.findIndex((x) => x.id === item.id)
      if (r >= 0) this.replies[r] = item
      else {
        this.replies.push(item)
        if (this.replies.length > REPLIES_MAX) this.replies.shift()
      }
    }
    this.push({ e: 'feed', item })
  }

  private note(tone: 'info' | 'ok' | 'warn' | 'error', ru: string, en: string): void {
    this.addFeed({ type: 'note', id: randomUUID(), ts: Date.now(), tone, ru, en })
  }

  private beat(k: Beat['k'], text: string, t = Date.now()): void {
    const b: Beat = { t, k, w: Math.min(1, Math.sqrt(text.length / 120)) }
    this.beats.push(b)
    if (this.beats.length > BEATS_MAX) this.beats.splice(0, this.beats.length - BEATS_MAX)
    this.push({ e: 'beat', b })
  }

  private decide(m: ChatMessage, trigger: Trigger, outcome: DecisionEntry['outcome'], extra: { chance?: number; detail?: string } = {}): void {
    const d: DecisionEntry = { id: randomUUID(), ts: Date.now(), name: m.name, text: m.text.slice(0, 160), trigger, outcome, ...extra }
    this.decisions.push(d)
    if (this.decisions.length > DECISIONS_MAX) this.decisions.splice(0, this.decisions.length - DECISIONS_MAX)
    this.push({ e: 'decision', d })
  }

  /** Lay past activity into the window (the demo starts with a chat already in full swing). */
  seed(s: Seed): void {
    for (const b of s.beats) {
      this.beats.push(b)
      this.push({ e: 'beat', b })
    }
    this.history.push(...s.history)
    for (const m of s.history) if (m.self) this.ownLines.add(m.id)
    for (const item of s.feed) this.addFeed(item)
    for (const d of s.decisions) {
      this.decisions.push(d)
      this.push({ e: 'decision', d })
    }
    this.arrivals = s.arrivals
    this.status.counters = { ...s.counters }
    this.status.llm = { ...s.llm }
    this.latencies = [s.llm.avgMs]
    this.pacer.nextWindowAt = s.nextWindowAt
    this.refreshRate()
    this.pushStatus()
  }

  clearFeed(): void {
    this.feed = []
    this.replies = []
    this.decisions = []
  }

  private refreshRate(): void {
    const now = Date.now()
    this.arrivals = this.arrivals.filter((t) => now - t < 60000)
    this.status.perMin = this.arrivals.length
  }

  // ------------------------------------------------------------------ start and stop

  private fail(ru: string, en: string): void {
    this.epoch++
    this.chat.disconnect()
    this.stopTimers()
    this.status.state = 'error'
    this.status.error = { ru, en }
    this.status.job = null
    this.note('error', ru, en)
    this.pushStatus()
  }

  async start(): Promise<void> {
    if (this.status.state === 'starting' || this.status.state === 'running') return
    const epoch = ++this.epoch
    const s = this.store.get()
    const channel = normalizeChannel(s.twitch.channel)
    const previous = this.status
    this.status = { ...freshStatus(), state: 'starting', channel, counters: previous.counters, llm: previous.llm }
    delete this.status.error
    this.pushStatus()
    if (!channel) return this.fail('Укажи канал, в чате которого отвечать', 'Enter the channel whose chat to answer in')

    // The model first: without it there is nothing to say. (The demo brings its own.)
    if (this.demo) {
      /* nothing to start */
    } else if (s.llm.source === 'builtin') {
      const up = await this.router.start()
      if (epoch !== this.epoch) return
      if (!up) {
        const why = this.router.status().error ?? ''
        return this.fail(`Нейросеть не запустилась. ${why}`.trim(), `The model router did not start. ${why}`.trim())
      }
      if (!s.llm.keylessDone) {
        try {
          await this.router.enableKeyless()
          this.store.patch({ llm: { keylessDone: true } })
        } catch {
          /* tried again on the next start */
        }
      }
    } else if (!s.llm.customBaseUrl) {
      return this.fail('Не указан адрес своего сервера модели', 'The address of your own model server is not set')
    }

    this.token = await this.auth.token()
    if (epoch !== this.epoch) return
    const account = this.auth.status()
    this.retriedAuth = false
    this.status.anonymous = !this.token
    this.status.login = this.token ? account.login : ''
    this.status.test = s.behavior.test || !this.token || !account.canChat
    this.pacer.reset()
    // Read the room for a few seconds before saying anything.
    this.pacer.nextWindowAt = Date.now() + 6000
    this.history = []
    this.arrivals = []
    this.recent = []
    this.chat.connect(account.login, this.token, channel)
    this.pushStatus()
  }

  private onJoined(channel: string): void {
    if (this.status.state !== 'starting' && this.status.state !== 'running') return
    const first = this.status.state === 'starting'
    this.status.state = 'running'
    if (first) {
      this.status.startedAt = Date.now()
      this.startTimers()
      if (this.status.anonymous) this.note('info', `Смотрю чат ${channel} как гость. Ответы пишутся, но не отправляются: войди в Twitch, чтобы отвечать`, `Watching ${channel} as a guest. Replies are written but not sent: sign in to Twitch to answer`)
      else if (this.status.test) this.note('info', `В чате ${channel}. Тестовый режим: ответы пишутся, но не отправляются`, `In ${channel}. Test mode: replies are written but not sent`)
      else this.note('ok', `В чате ${channel} как ${this.status.login}. Отвечаю`, `In ${channel} as ${this.status.login}. Answering`)
    } else this.note('ok', 'Снова в чате', 'Back in the chat')
    this.pushStatus()
  }

  stop(reason?: { ru: string; en: string }): void {
    if (this.status.state === 'idle') return
    this.epoch++
    this.chat.disconnect()
    this.stopTimers()
    const wasRunning = this.status.state === 'running'
    this.status.state = 'idle'
    this.status.job = null
    this.status.pausedUntil = 0
    delete this.status.pauseReason
    delete this.status.error
    this.status.twitch = 'offline'
    if (reason) this.note('info', reason.ru, reason.en)
    else if (wasRunning) this.note('info', 'Остановлено', 'Stopped')
    this.pushStatus()
  }

  async restart(): Promise<void> {
    if (this.status.state !== 'running' && this.status.state !== 'starting') return
    this.stop({ ru: 'Перезапуск с новыми настройками', en: 'Restarting with the new settings' })
    await this.start()
  }

  private startTimers(): void {
    this.stopTimers()
    this.tick = setInterval(() => this.onTick(), 3000)
    void this.pollStream()
    this.streamTimer = setInterval(() => void this.pollStream(), 90000)
    // Keeps Windows from suspending the app while it works in the background.
    this.blocker = powerSaveBlocker.start('prevent-app-suspension')
  }

  private stopTimers(): void {
    if (this.tick) clearInterval(this.tick)
    if (this.streamTimer) clearInterval(this.streamTimer)
    this.tick = null
    this.streamTimer = null
    if (this.blocker !== null && powerSaveBlocker.isStarted(this.blocker)) powerSaveBlocker.stop(this.blocker)
    this.blocker = null
  }

  private onTick(): void {
    const now = Date.now()
    const before = this.status.perMin
    this.refreshRate()
    let changed = before !== this.status.perMin
    if (this.status.pausedUntil && now >= this.status.pausedUntil) {
      this.status.pausedUntil = 0
      delete this.status.pauseReason
      this.note('ok', 'Пауза закончилась, снова отвечаю', 'The hold is over, answering again')
      changed = true
    }
    const hours = this.store.get().behavior.autoStopHours
    if (hours > 0 && this.status.startedAt && now - this.status.startedAt > hours * 3600_000) {
      return this.stop({ ru: `Остановлено: прошло ${hours} ч, как задано в настройках`, en: `Stopped after ${hours} h, as set in the settings` })
    }
    // Follow the test switch without a restart.
    const test = this.store.get().behavior.test || this.status.anonymous || !this.auth.status().canChat
    if (test !== this.status.test) {
      this.status.test = test
      changed = true
    }
    if (changed) this.pushStatus()
  }

  private async pollStream(): Promise<void> {
    if (this.demo) {
      this.status.stream = { known: true, live: true, ...this.demo.stream }
      return this.pushStatus()
    }
    const t = this.store.get().twitch
    if (!this.token || !t.tokenClientId || !this.status.channel) return
    const info = await streamInfo(this.token, t.tokenClientId, this.status.channel)
    if (!info) return
    this.status.stream = { known: true, ...info }
    this.pushStatus()
  }

  // ------------------------------------------------------------------ holds

  private hold(reason: PauseReason, until: number, ru: string, en: string): void {
    const longer = until > this.status.pausedUntil
    if (longer) this.status.pausedUntil = until
    this.status.pauseReason = reason
    if (longer) this.note('warn', ru, en)
    this.pushStatus()
  }

  /** Lift a hold by hand. */
  resume(): void {
    if (!this.status.pausedUntil) return
    this.status.pausedUntil = 0
    delete this.status.pauseReason
    this.note('ok', 'Пауза снята', 'The hold is lifted')
    this.pushStatus()
  }

  private onPunished(seconds: number): void {
    if (seconds > 0) {
      const minutes = Math.max(1, Math.ceil(seconds / 60))
      this.hold('timeout', Date.now() + seconds * 1000 + 5000, `Аккаунт получил тайм-аут на ${minutes} мин. Жду, пока он закончится`, `The account was timed out for ${minutes} min. Waiting for it to end`)
    } else this.stop({ ru: 'Остановлено: аккаунт забанен в этом чате', en: 'Stopped: the account is banned from this chat' })
  }

  private onNotice(id: string, text: string): void {
    const known = explainNotice(id)
    // A refusal that arrives right after a send is about that send.
    const sent = this.lastSend && Date.now() - this.lastSend.at < 5000 ? this.lastSend.item : null
    if (known && sent) {
      this.lastSend = null
      this.addFeed({ ...sent, status: 'rejected', note: `${known.ru}|${known.en}` })
      this.status.counters.replies = Math.max(0, this.status.counters.replies - 1)
      this.status.counters.dropped++
    }
    if (!known) {
      if (text && id !== 'host_on' && id !== 'host_off') this.note('info', `Twitch: ${text}`, `Twitch: ${text}`)
      return
    }
    if (known.hold === 'banned') return this.stop({ ru: `Остановлено: ${known.ru.toLowerCase()}`, en: `Stopped: ${known.en.toLowerCase()}` })
    if (known.hold === 'timeout') {
      const m = /(\d+)\s+more\s+(second|minute|hour)/i.exec(text)
      const seconds = m ? Number(m[1]) * (m[2].startsWith('hour') ? 3600 : m[2].startsWith('minute') ? 60 : 1) : 300
      return this.hold('timeout', Date.now() + seconds * 1000 + 5000, `${known.ru}. Жду ${Math.ceil(seconds / 60)} мин`, `${known.en}. Waiting ${Math.ceil(seconds / 60)} min`)
    }
    if (known.hold === 'room') return this.hold('room', Date.now() + 10 * 60000, `${known.ru}. Пробую снова через 10 мин`, `${known.en}. Trying again in 10 min`)
    if (!sent) this.note('warn', known.ru, known.en)
    this.pushStatus()
  }

  private async onAuthFail(): Promise<void> {
    if (this.status.state !== 'starting' && this.status.state !== 'running') return
    // An access token lasts a few hours. Renew it once and come back; a second refusal is final.
    const renewed = this.retriedAuth ? '' : await this.auth.rejected()
    this.retriedAuth = true
    if (renewed && (this.status.state === 'starting' || this.status.state === 'running')) {
      this.token = renewed
      this.chat.connect(this.status.login, renewed, this.status.channel)
      return
    }
    this.fail('Twitch не принял вход. Войди в аккаунт заново на странице «Аккаунт»', 'Twitch refused the sign-in. Sign in again on the Account page')
  }

  // ------------------------------------------------------------------ every chat line

  private onMessage(m: ChatMessage): void {
    if (this.status.state !== 'running') return
    const s = this.store.get()
    const own = this.status.login
    if (own && m.login === own) m.self = true
    this.history.push(m)
    if (this.history.length > HISTORY_MAX) this.history.shift()
    this.addFeed({ type: 'msg', id: m.id, ts: m.ts, msg: m })

    if (m.self) {
      this.ownLines.add(m.id)
      this.learn(m.text)
      const minutes = s.behavior.pauseWhenITalkMin
      if (minutes > 0) this.hold('you_typed', Date.now() + minutes * 60000, `Ты пишешь в чат сам: молчу ${minutes} мин, чтобы не перебивать`, `You are typing in chat yourself: staying quiet for ${minutes} min`)
      return
    }

    this.status.counters.seen++
    this.arrivals.push(Date.now())
    this.refreshRate()
    const now = Date.now()
    // How many of the last messages say exactly this: a chant or a copypasta going round.
    const key = dedupeKey(m.text)
    let repeats = 0
    for (let i = this.history.length - 2; i >= 0 && i >= this.history.length - 31; i--) if (dedupeKey(this.history[i].text) === key) repeats++
    let decision = this.pacer.consider(m, s.behavior, { now, ownLogin: own, perMin: this.status.perMin, busy: this.status.job !== null, paused: now < this.status.pausedUntil, slow: this.chat.privileged ? 0 : this.status.room.slow, repeats })
    if (this.demo) {
      // The demo follows a script: the lines it has answers for get one, the rest are passed over.
      if (this.demo.scripted(m.text)) decision = this.status.job ? { reply: false, trigger: decision.trigger, reason: 'busy' } : { reply: true, trigger: decision.trigger, chance: decision.chance ?? 0.4 }
      else if (decision.reply) decision = { reply: false, trigger: decision.trigger, reason: 'chance', chance: decision.chance ?? 0.2 }
    }
    this.beat(decision.trigger === 'mention' ? 'a' : 'm', m.text, now)

    if (decision.reply && s.behavior.onlyWhenLive && this.status.stream.known && !this.status.stream.live) {
      this.decide(m, decision.trigger, 'offline_stream')
      return
    }
    if (!decision.reply) {
      // This one is for the person behind the account.
      if (decision.reason === 'bot_question' && decision.trigger === 'mention') this.note('warn', `${m.name} спрашивает, не бот ли ты. Brackets на такое не отвечает: ответь сам`, `${m.name} is asking whether you are a bot. Brackets does not answer that: reply yourself`)
      if (decision.reason && WORTH_SHOWING.includes(decision.reason)) this.decide(m, decision.trigger, decision.reason, decision.chance === undefined ? {} : { chance: decision.chance })
      // The counters move on every message; the window needs them, but not more than a few times a second.
      this.pushStatus()
      return
    }
    void this.reply(m, decision)
  }

  /** What the person types in chat themself is the best example of how they write. */
  private learn(text: string): void {
    const p = this.store.get().persona
    const line = text.trim()
    if (!p.learnFromMe || line.length < 2 || line.length > 140 || /^[!/.]/.test(line) || hasLink(line) || wordLetters(line) < 2) return
    if ([...p.examples, ...p.learned].some((x) => x.toLowerCase() === line.toLowerCase())) return
    const learned = [...p.learned, line].slice(-30)
    // Saved a little later, so a burst of messages is one write.
    if (this.learnTimer) clearTimeout(this.learnTimer)
    this.learnTimer = setTimeout(() => this.store.patch({ persona: { learned } }), 1500)
    p.learned = learned
  }

  // ------------------------------------------------------------------ writing a reply

  private endpoint(): { baseUrl: string; apiKey: string; model: string } | null {
    if (this.demo) return { baseUrl: 'demo', apiKey: '', model: 'demo' }
    const l = this.store.get().llm
    if (l.source === 'custom') return l.customBaseUrl ? { baseUrl: l.customBaseUrl, apiKey: this.store.secret('llm.customKey'), model: l.customModel || 'default' } : null
    const e = this.router.endpoint()
    return e ? { ...e, model: l.model || 'auto' } : null
  }

  private language(): Lang {
    const s = this.store.get()
    if (s.persona.lang !== 'auto') return s.persona.lang
    const fallback: Lang = /[\u0400-\u04FF]/.test(s.persona.about) ? 'ru' : 'en'
    return detectLang(this.history.slice(-25).map((m) => m.text), fallback)
  }

  private promptFor(target: ChatMessage, trigger: Trigger): ChatPrompt & { lang: Lang; target: string; from: string } {
    const s = this.store.get()
    const history: PromptLine[] = this.history
      .filter((m) => m.id !== target.id)
      .slice(-s.behavior.contextSize)
      .map((m) => ({ name: m.name, text: m.text, own: m.self || this.ownLines.has(m.id) }))
    const lang = this.language()
    const prompt = buildPrompt(s.persona, {
      login: this.status.login || 'viewer',
      channel: this.status.channel || normalizeChannel(s.twitch.channel) || 'channel',
      title: this.status.stream.title,
      game: this.status.stream.game,
      history,
      target: { name: target.name, text: target.text },
      trigger,
      lang,
      maxChars: s.behavior.maxChars,
      reaction: trigger !== 'mention' && isReaction(target.text)
    })
    return { ...prompt, lang, target: target.text, from: target.name }
  }

  /**
   * Words in the recent chat that look like channel emotes (KEKW, catJAM, Smokerge). An emote only
   * shows as a picture with its exact capitals, so "all lowercase" must leave these alone.
   */
  private chatEmotes(): string[] {
    const seen = new Map<string, number>()
    for (const m of this.history.slice(-40)) {
      const russian = /[\u0400-\u04FF]/.test(m.text)
      for (const token of m.text.split(/\s+/)) {
        if (!/^[A-Za-z][A-Za-z0-9]{2,24}$/.test(token) || token === token.toLowerCase()) continue
        // Sure signs: capitals inside the word, or a capitalised Latin word in a Russian sentence.
        // Otherwise the same spelling has to turn up twice.
        seen.set(token, (seen.get(token) ?? 0) + (/[A-Z]/.test(token.slice(1)) || russian ? 2 : 1))
      }
    }
    return [...seen].filter(([, weight]) => weight >= 2).map(([token]) => token)
  }

  /** Ask the model and clean the answer. One more try when the first is unusable. */
  private async write(prompt: ChatPrompt & { lang: Lang; target?: string; from?: string }): Promise<{ ok: true; text: string; raw: string; via: string; ms: number } | { ok: false; reason: DropReason; detail: string; raw: string; via: string; ms: number }> {
    const s = this.store.get()
    const at = this.endpoint()
    if (!at) return { ok: false, reason: 'llm_error', detail: 'The model is not ready', raw: '', via: '', ms: 0 }
    let last: { reason: DropReason; detail: string; raw: string; via: string; ms: number } = { reason: 'empty', detail: '', raw: '', via: '', ms: 0 }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.model({ ...at, system: prompt.system, user: prompt.user, temperature: Math.min(2, s.llm.temperature + attempt * 0.15), maxTokens: s.llm.maxTokens, timeoutMs: s.llm.timeoutSec * 1000, ...(prompt.target === undefined ? {} : { target: prompt.target }) })
        this.latencies.push(res.ms)
        if (this.latencies.length > 30) this.latencies.shift()
        this.status.llm.lastVia = res.via
        this.status.llm.lastMs = res.ms
        this.status.llm.avgMs = Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length)
        const clean = sanitizeReply(res.text, {
          maxChars: s.behavior.maxChars,
          lowercase: s.persona.lowercase,
          noPeriod: s.persona.noPeriod,
          emoji: s.persona.emoji,
          keepCase: [...COMMON_EMOTES, ...s.persona.emotes, ...this.chatEmotes()],
          blocked: s.behavior.blocked,
          ownLogin: this.status.login,
          lang: prompt.lang,
          ...(prompt.target && prompt.from ? { target: { name: prompt.from, text: prompt.target } } : {})
        })
        if (!clean.ok) {
          last = { reason: clean.reason, detail: res.text.slice(0, 200), raw: res.text, via: res.via, ms: res.ms }
          // The model passed on purpose; asking again would only push it into saying something.
          if (clean.reason === 'nothing') break
          continue
        }
        if (this.recent.includes(dedupeKey(clean.text))) {
          last = { reason: 'repeat', detail: clean.text, raw: res.text, via: res.via, ms: res.ms }
          continue
        }
        return { ok: true, text: addBrackets(clean.text, s.persona.brackets), raw: res.text, via: res.via, ms: res.ms }
      } catch (err) {
        const e = err as LlmError
        this.status.llm.errors++
        this.status.llm.lastError = e.message
        last = { reason: 'llm_error', detail: e.message, raw: '', via: '', ms: 0 }
        // The router has no provider to offer, or timed out: asking again at once changes nothing.
        if (!(e instanceof LlmError) || e.code === 'timeout' || e.code === 'unreachable' || e.status === 503 || e.status === 401) break
        // Right after its first start the router is still fetching its list of models and offers
        // ones that no longer exist. A few seconds later it knows better.
        if (e.status === 404 && attempt === 0) await sleep(3500)
      }
    }
    return { ok: false, ...last }
  }

  private async reply(m: ChatMessage, decision: Decision, forced = false): Promise<void> {
    const epoch = this.epoch
    const s = this.store.get()
    const b: Behavior = s.behavior
    const job: Job = { id: randomUUID(), phase: 'reading', to: { name: m.name, text: m.text }, trigger: decision.trigger, startedAt: Date.now() }
    this.status.job = job
    this.push({ e: 'pick', id: m.id })
    const picked = this.feed.find((f) => f.id === m.id)
    if (picked && picked.type === 'msg') picked.picked = true
    this.pushStatus()

    const drop = (reason: DropReason, detail = ''): void => {
      if (epoch !== this.epoch) return
      this.status.counters.dropped++
      this.decide(m, decision.trigger, reason, detail ? { detail } : {})
      this.pacer.onDrop(Date.now())
    }

    try {
      if (b.typing !== 'instant') await sleep(300 + Math.random() * 600)
      if (epoch !== this.epoch) return
      job.phase = 'thinking'
      this.pushStatus()

      const written = await this.write(this.promptFor(m, decision.trigger))
      if (epoch !== this.epoch) return
      if (!written.ok) return drop(written.reason, written.detail)

      // Being called by name is answered to that person; a remark on the chat is just said.
      const mode = b.replyMode === 'auto' ? (decision.trigger === 'mention' ? 'thread' : 'plain') : b.replyMode
      // A display name in another script (日本語, кириллица) does not work after "@"; the login always does.
      const handle = m.name.toLowerCase() === m.login ? m.name : m.login
      const text = mode === 'mention' ? `@${handle} ${written.text}` : written.text

      const wait = Math.max(0, typingDelay(b.typing, m.text, written.text) - written.ms)
      job.phase = 'typing'
      job.text = text
      job.via = written.via
      job.sendAt = Date.now() + wait
      this.pushStatus()
      await sleep(wait)
      if (epoch !== this.epoch) return

      const now = Date.now()
      if (now < this.status.pausedUntil) return drop('paused')
      // A reply to something said a minute ago reads as a glitch.
      const limit = b.maxStaleSec * (decision.trigger === 'mention' || forced ? 3 : 1) * 1000
      if (now - m.ts > limit) return drop('stale', `${Math.round((now - m.ts) / 1000)} s`)

      const test = this.status.test
      const item: ReplyItem = { type: 'reply', id: randomUUID(), ts: now, text, to: { id: m.id, login: m.login, name: m.name, text: m.text }, trigger: decision.trigger, via: written.via, ms: written.ms, status: test ? 'test' : 'sent' }
      if (!test) {
        if (!this.chat.say(text, mode === 'thread' ? m.id : undefined)) return drop('rejected', 'offline')
        this.lastSend = { item, at: now }
        this.status.counters.replies++
      } else this.status.counters.tests++

      this.pacer.onReply(now, decision.trigger, m.login, b, this.chat.privileged ? 0 : this.status.room.slow)
      // The demo cycles through a short script, so the same answer is meant to come round again.
      if (!this.demo) this.recent.push(dedupeKey(written.text))
      if (this.recent.length > 12) this.recent.shift()
      // Twitch does not echo a message back to its sender, so the app remembers its own lines.
      const mine: ChatMessage = { ...m, id: item.id, ts: now, login: this.status.login || 'you', name: this.status.login || 'you', text, color: '', mod: false, broadcaster: false, vip: false, sub: false, first: false, action: false, emoteOnly: false, self: true }
      delete mine.replyTo
      this.ownLines.add(mine.id)
      this.history.push(mine)
      if (this.history.length > HISTORY_MAX) this.history.shift()
      this.addFeed(item)
      this.beat(test ? 'd' : 'r', text, now)
      this.decide(m, decision.trigger, 'reply', { detail: text, ...(decision.chance === undefined ? {} : { chance: decision.chance }) })
    } catch (err) {
      drop('llm_error', String((err as Error)?.message ?? err))
    } finally {
      if (this.status.job === job) {
        this.status.job = null
        this.pushStatus()
      }
    }
  }

  /** Answer the latest message that can be answered, right now, whatever the pause says. */
  replyNow(): boolean {
    if (this.status.state !== 'running' || this.status.job) return false
    const b = this.store.get().behavior
    const own = this.status.login
    for (let i = this.history.length - 1; i >= 0; i--) {
      const m = this.history[i]
      if (Date.now() - m.ts > 3 * 60000) break
      const trigger = classify(m, b, own)
      if (m.self || this.ownLines.has(m.id) || ineligible(m, b, own, trigger)) continue
      void this.reply(m, { reply: true, trigger }, true)
      return true
    }
    return false
  }

  // ------------------------------------------------------------------ trying the manner out

  /** Write sample replies to a made-up message, for the Style page. Nothing is sent anywhere. */
  async sample(message: string, count: number): Promise<LlmSample[]> {
    const s = this.store.get()
    if (!this.demo && s.llm.source === 'builtin') {
      const up = await this.router.start()
      if (!up) return [{ ok: false, text: '', raw: '', via: '', ms: 0, error: this.router.status().error ?? 'The model router did not start' }]
      if (!s.llm.keylessDone) {
        try {
          await this.router.enableKeyless()
          this.store.patch({ llm: { keylessDone: true } })
        } catch {
          /* tried again later */
        }
      }
    }
    const text = message.trim() || 'ну и как вам стрим сегодня'
    const target: ChatMessage = { id: 'sample', ts: Date.now(), channel: this.status.channel, login: 'viewer', name: 'viewer', color: '', text, mod: false, broadcaster: false, vip: false, sub: false, first: false, action: false, emoteOnly: false }
    const prompt = this.promptFor(target, classify(target, s.behavior, this.status.login))
    const runs = Array.from({ length: Math.max(1, Math.min(4, count)) }, () => this.write(prompt))
    return (await Promise.all(runs)).map((r) => (r.ok ? { ok: true, text: r.text, raw: r.raw, via: r.via, ms: r.ms } : { ok: false, text: '', raw: r.raw, via: r.via, ms: r.ms, error: `${r.reason}${r.detail ? ': ' + r.detail : ''}` }))
  }

  /** The instructions the model would get right now, to show on the Style page. */
  promptPreview(message: string): ChatPrompt {
    const text = message.trim() || 'ну и как вам стрим сегодня'
    const target: ChatMessage = { id: 'sample', ts: Date.now(), channel: this.status.channel, login: 'viewer', name: 'viewer', color: '', text, mod: false, broadcaster: false, vip: false, sub: false, first: false, action: false, emoteOnly: false }
    const { system, user } = this.promptFor(target, 'chat')
    return { system, user }
  }
}
