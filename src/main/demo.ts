// A made-up chat for showing the app without Twitch, an account or a model: a small stream where
// someone draws pixel art, a dozen invented viewers, and answers written in advance. Everything
// else is the real thing: the same pacing, clean-up, feed and rhythm strip.
//
// Start it with `npm run demo` (English) or `electron . --demo=ru`. It keeps its settings in a
// folder of its own and never connects to Twitch. The pictures in the README are made with it.
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { defaultPersona } from '@shared/defaults'
import type { AuthStatus, Beat, BotStatus, ChatMessage, DecisionEntry, DeepPartial, FeedItem, Lang, ReplyItem, Settings, Trigger } from '@shared/types'
import type { Bot, DemoScene, Model, Seed } from './bot'
import type { ChatEvents, ChatState } from './twitch/chat'

interface Viewer {
  login: string
  color: string
  streamer?: boolean
}

interface Line {
  who: string
  text: string
  /** Answers the scripted model gives to this line, used in turn. */
  replies?: string[]
  trigger?: Trigger
}

interface Script {
  channel: string
  login: string
  stream: { title: string; game: string; viewers: number }
  filler: string[]
  keys: Line[]
  /** What the scripted model says to a message it has no answer for (the "Try it" box). */
  generic: string[]
}

const VIEWERS: Viewer[] = [
  { login: 'mossboy', color: '#8ce99a' },
  { login: 'nina_plays', color: '#faa2c1' },
  { login: 'kettlecorn', color: '#ffd43b' },
  { login: 'void_frog', color: '#b197fc' },
  { login: 'sashadev', color: '#74c0fc' },
  { login: 'lumenize', color: '#ffa94d' },
  { login: 'birchwood', color: '#63e6be' },
  { login: 'tapioca_t', color: '#e599f7' },
  { login: 'okaywren', color: '#ff7a7a' },
  { login: 'dotmatrix', color: '#66d9e8' },
  { login: 'plumtart', color: '#91a7ff' },
  { login: 'quietgiant', color: '#c0eb75' },
  { login: 'pixel_harbor', color: '#f2b544', streamer: true }
]

const SCRIPTS: Record<Lang, Script> = {
  en: {
    channel: 'pixel_harbor',
    login: 'tea_goblin',
    stream: { title: 'cozy pixel art: building a harbor town', game: 'Art', viewers: 214 },
    filler: [
      'that palette is so good',
      'the water looks alive',
      'LUL the seagull',
      'ok the roof tiles are perfect',
      'first time here, so calming',
      'catJAM',
      'the dithering on those rocks',
      'add a tiny boat',
      'i could watch this for hours',
      'KEKW the cat is back',
      'how is it only 64 pixels wide',
      'saving this palette',
      'the lamp glow though',
      'so clean',
      'more seagulls pls',
      'hello from brazil',
      'this song fits so well',
      'undo undo undo',
      'the pier needs a fisherman',
      'tiny fisherman yes',
      'gm chat',
      'what did i miss',
      'Clap',
      'that shadow fixed everything',
      'the boat needs a name',
      'cozy stream best stream',
      'wait is that a crab',
      'crab confirmed',
      'the chimney smoke is a nice touch',
      'i need this as a wallpaper',
      'two more windows on the left house?',
      'the sky gradient is unreal',
      'brb making tea',
      'back, what changed',
      'she said no more seagulls KEKW',
      'the colors feel like evening',
      'one more boat and its a fleet',
      'best part of my day honestly',
      'PogChamp the reflection',
      'zoom in on the little shop'
    ],
    keys: [
      { who: 'nina_plays', text: 'what brush is that?', replies: ['just the 1px pencil i think, she never changes it)', 'looks like the plain 1 pixel pencil)', 'pencil tool, nothing fancy'] },
      { who: 'mossboy', text: '@tea_goblin did you finish your sprite?', replies: ['almost, the legs still look like noodles))', 'kinda, the walk cycle is cursed tho)'], trigger: 'mention' },
      { who: 'pixel_harbor', text: 'chat should we add a lighthouse?', replies: ['lighthouse yes, with a tiny light that blinks)', 'yes and make the light blink)'] },
      { who: 'kettlecorn', text: 'how long has she been drawing today?', replies: ['like three hours i think, time flies here)', 'around 3 hours)'] },
      { who: 'void_frog', text: 'is this for the game jam?', replies: ['pretty sure its for the harbor game, not the jam', 'nah its the harbor project i think)'] },
      { who: 'okaywren', text: 'why does the water look so good', replies: ['its the two extra blues, she said it earlier)', 'two more blues in the palette, thats all)'] }
    ],
    generic: ['lol fair)', 'honestly same', 'wait really? did not know that)']
  },
  ru: {
    channel: 'pixel_harbor',
    login: 'tea_goblin',
    stream: { title: 'уютный пиксель-арт: рисуем портовый городок', game: 'Art', viewers: 214 },
    filler: [
      'какая палитра красивая',
      'вода как живая',
      'ахах чайка',
      'крыша получилась идеально',
      'первый раз тут, так спокойно',
      'catJAM',
      'дизеринг на камнях огонь',
      'добавь лодочку',
      'могу смотреть это часами',
      'KEKW кот вернулся',
      'как это всего 64 пикселя в ширину',
      'сохранил палитру себе',
      'свет от фонаря топ',
      'чисто',
      'ещё чаек пж',
      'всем привет из Минска',
      'музыка идеально подходит',
      'ctrl z ctrl z',
      'на пирсе нужен рыбак',
      'маленький рыбак да',
      'доброе утро чат',
      'что я пропустил',
      'Clap',
      'тень всё исправила',
      'лодке нужно имя',
      'уютные стримы лучшие',
      'стоп это краб?',
      'краб подтверждён',
      'дым из трубы прям в тему',
      'хочу это на обои',
      'может ещё два окна слева?',
      'градиент неба нереальный',
      'ща вернусь, чай поставлю',
      'вернулся, что поменялось',
      'она сказала чаек больше не будет KEKW',
      'цвета как вечером',
      'ещё лодка и будет флот',
      'лучшая часть дня честно',
      'PogChamp отражение',
      'приблизь магазинчик'
    ],
    keys: [
      { who: 'nina_plays', text: 'а что за кисть?', replies: ['вроде обычный карандаш в 1 пиксель)', 'карандаш на 1 пиксель, она его не меняет)', 'обычный карандаш вроде'] },
      { who: 'mossboy', text: '@tea_goblin ты спрайт доделал?', replies: ['почти, ноги пока как макароны))', 'ну типо да, но походка кринж)'], trigger: 'mention' },
      { who: 'pixel_harbor', text: 'чат, добавим маяк?', replies: ['маяк да, и чтоб огонёк мигал)', 'да и пусть мигает)'] },
      { who: 'kettlecorn', text: 'сколько она уже рисует сегодня?', replies: ['часа три вроде, тут время летит)', 'около трёх часов)'] },
      { who: 'void_frog', text: 'это для джема?', replies: ['не, это для игры про порт вроде', 'хз, вроде для своей игры)'] },
      { who: 'okaywren', text: 'почему вода так красиво выглядит', replies: ['там два доп синих, она говорила)', 'два лишних синих в палитре и всё)'] }
    ],
    generic: ['ахах ну да)', 'жиза', 'а че реально? не знал)']
  }
}

const VIAS = ['groq/llama-3.3-70b-versatile', 'google/gemini-2.5-flash', 'cerebras/llama-3.3-70b']
/** Seconds after the start at which the scripted lines come, one cycle. */
const KEY_TIMES = [3, 12, 21.5, 31, 40.5, 50]
const CYCLE = 59

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The same "random" numbers every run, so the demo and its pictures look the same each time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const weight = (text: string): number => Math.min(1, Math.sqrt(text.length / 120))

class DemoChat extends EventEmitter<ChatEvents> {
  state: ChatState = 'offline'
  room: BotStatus['room'] = { slow: 0, followersOnly: -1, subsOnly: false, emoteOnly: false }
  privileged = false
  private timers: NodeJS.Timeout[] = []
  private script: Script
  private rng = seeded(7)
  private lastWho = ''
  /** The lines said lately, so the crowd does not repeat itself every few seconds. */
  private said: string[] = []

  constructor(script: Script) {
    super()
    this.script = script
  }

  private setState(state: ChatState): void {
    this.state = state
    this.emit('state', state)
  }

  message(who: string, text: string, ts = Date.now()): ChatMessage {
    const v = VIEWERS.find((x) => x.login === who) ?? VIEWERS[0]
    return { id: randomUUID(), ts, channel: this.script.channel, login: v.login, name: v.login, color: v.color, text, mod: false, broadcaster: Boolean(v.streamer), vip: false, sub: false, first: false, action: false, emoteOnly: false }
  }

  /** Someone from the crowd saying something from the pool; never the same person or line twice running. */
  filler(ts = Date.now()): ChatMessage {
    const crowd = VIEWERS.filter((v) => !v.streamer && v.login !== this.lastWho)
    const who = crowd[Math.floor(this.rng() * crowd.length)].login
    const pool = this.script.filler.filter((t) => !this.said.includes(t))
    const text = pool[Math.floor(this.rng() * pool.length)]
    this.lastWho = who
    this.said.push(text)
    if (this.said.length > 26) this.said.shift()
    return this.message(who, text, ts)
  }

  /** The gap to the next message, in milliseconds: a chat of about forty lines a minute. */
  gap(): number {
    return 950 + this.rng() * 1000
  }

  connect(_login: string, _token: string, channel: string): void {
    this.disconnect()
    this.setState('connecting')
    this.timers.push(
      setTimeout(() => {
        this.setState('connected')
        this.emit('room', { ...this.room })
        this.emit('joined', channel)
        this.run()
      }, 350)
    )
  }

  private run(): void {
    const started = Date.now()
    let key = 0
    // When the next scripted line is due: KEY_TIMES within a cycle, cycle after cycle.
    const due = (): number => started + (Math.floor(key / KEY_TIMES.length) * CYCLE + KEY_TIMES[key % KEY_TIMES.length]) * 1000
    const tick = (): void => {
      if (Date.now() >= due()) {
        const line = this.script.keys[key % this.script.keys.length]
        key++
        this.emit('message', this.message(line.who, line.text))
      } else this.emit('message', this.filler())
      this.timers = this.timers.slice(-4)
      this.timers.push(setTimeout(tick, this.gap()))
    }
    this.timers.push(setTimeout(tick, 500))
  }

  disconnect(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    if (this.state !== 'offline') this.setState('offline')
  }

  /** Nothing is sent anywhere; the reply simply counts as sent. */
  say(): boolean {
    return this.state === 'connected'
  }
}

/** An account that is always signed in, and can show the code screen for a picture of it. */
class DemoAuth extends EventEmitter {
  private login: string
  private stage: 'in' | 'device' = 'in'

  constructor(login: string) {
    super()
    this.login = login
  }

  status(): AuthStatus {
    if (this.stage === 'device') return { signedIn: false, login: '', expiresAt: 0, scopes: [], canChat: false, renews: false, device: { userCode: 'QWJTMBZD', url: 'https://www.twitch.tv/activate', expiresAt: Date.now() + 29 * 60000 } }
    return { signedIn: true, login: this.login, expiresAt: Date.now() + 4 * 3600000, scopes: ['chat:read', 'chat:edit'], canChat: true, renews: true }
  }

  setStage(stage: 'in' | 'device'): void {
    this.stage = stage
    this.emit('changed', this.status())
  }

  async token(): Promise<string> {
    return 'demo'
  }
  async rejected(): Promise<string> {
    return ''
  }
  async startDevice(): Promise<AuthStatus> {
    this.setStage('device')
    return this.status()
  }
  cancelDevice(): AuthStatus {
    this.setStage('in')
    return this.status()
  }
  async setToken(): Promise<AuthStatus> {
    return this.status()
  }
  async signOut(): Promise<AuthStatus> {
    return this.status()
  }
}

export interface Demo {
  chat: DemoChat
  auth: DemoAuth
  model: Model
  scene: DemoScene
  /** What the demo profile is set to. */
  settings: DeepPartial<Settings>
  /** A line the scripted model has three different answers for, to show in the "Try it" box. */
  tryLine: string
  /** Fill the window with two minutes of past chat as soon as the responder has joined. */
  attach(bot: Bot): void
}

export function createDemo(lang: Lang): Demo {
  const script = SCRIPTS[lang]
  const chat = new DemoChat(script)
  const auth = new DemoAuth(script.login)
  const answers = new Map(script.keys.map((k) => [k.text, k.replies ?? []]))
  const used = new Map<string, number>()
  let calls = 0

  const model: Model = async (args) => {
    const started = Date.now()
    await sleep(650 + (calls % 4) * 130)
    const target = args.target ?? ''
    const variants = answers.get(target)?.length ? answers.get(target)! : script.generic
    const n = used.get(target) ?? 0
    used.set(target, n + 1)
    return { text: variants[n % variants.length], via: VIAS[calls++ % VIAS.length], ms: Date.now() - started }
  }

  const seed = (): Seed => {
    const now = Date.now()
    const feed: FeedItem[] = []
    const decisions: DecisionEntry[] = []
    const beats: Beat[] = []
    const history: ChatMessage[] = []
    const arrivals: number[] = []
    const rng = seeded(21)
    // Three scripted lines that were "answered" before the window opened.
    const past = [
      { at: now - 97000, line: script.keys[3] },
      { at: now - 62000, line: script.keys[4] },
      { at: now - 27000, line: script.keys[5] }
    ]
    let seen = 0
    let t = now - 118000
    let p = 0
    while (t < now - 900) {
      const key = p < past.length && t >= past[p].at ? past[p++] : null
      const m = key ? chat.message(key.line.who, key.line.text, t) : chat.filler(t)
      seen++
      beats.push({ t, k: 'm', w: weight(m.text) })
      if (now - t < 60000) arrivals.push(t)
      // Only the last half minute is in the feed; the strip shows the rest.
      const recent = now - t < 30000
      if (recent || key) feed.push({ type: 'msg', id: m.id, ts: t, msg: m, ...(key ? { picked: true } : {}) })
      if (recent) history.push(m)
      if (key) {
        const text = key.line.replies?.[0] ?? ''
        const sentAt = t + 4600
        const trigger: Trigger = key.line.trigger ?? 'question'
        const reply: ReplyItem = { type: 'reply', id: randomUUID(), ts: sentAt, text, to: { id: m.id, login: m.login, name: m.name, text: m.text }, trigger, via: VIAS[p % VIAS.length], ms: 780 + p * 60, status: 'sent' }
        feed.push(reply)
        beats.push({ t: sentAt, k: 'r', w: weight(text) })
        decisions.push({ id: randomUUID(), ts: sentAt, name: m.name, text: m.text, trigger, outcome: 'reply', detail: text })
        if (now - sentAt < 30000) history.push({ ...m, id: reply.id, ts: sentAt, login: script.login, name: script.login, text, color: '', broadcaster: false, self: true })
      } else if (rng() < 0.11) {
        decisions.push({ id: randomUUID(), ts: t, name: m.name, text: m.text, trigger: 'chat', outcome: 'chance', chance: 0.06 + rng() * 0.2 })
      }
      t += chat.gap()
    }
    feed.sort((a, b) => a.ts - b.ts)
    beats.sort((a, b) => a.t - b.t)
    decisions.sort((a, b) => a.ts - b.ts)
    history.sort((a, b) => a.ts - b.ts)
    return { feed, decisions, beats, history, arrivals, counters: { seen, replies: past.length, tests: 0, dropped: 0 }, llm: { lastVia: VIAS[0], lastMs: 840, avgMs: 870, errors: 0, lastError: '' }, nextWindowAt: now + 2500 }
  }

  return {
    chat,
    auth,
    model,
    scene: { stream: script.stream, scripted: (text) => answers.has(text) },
    tryLine: script.keys[0].text,
    settings: {
      ui: { lang, stripMin: 2, theme: 'brackets', scheme: 'dark', closeToTray: false, autoStart: false },
      twitch: { channel: script.channel },
      // The brackets are already in the scripted answers.
      persona: { ...defaultPersona(lang), brackets: 0, learnFromMe: false },
      behavior: { preset: 'active', minGapSec: 45, maxGapSec: 120, maxPerHour: 45, test: false, typing: 'fast', pauseWhenITalkMin: 0, maxStaleSec: 90, replyMode: 'auto' }
    },
    attach(bot) {
      chat.on('joined', () => bot.seed(seed()))
    }
  }
}
