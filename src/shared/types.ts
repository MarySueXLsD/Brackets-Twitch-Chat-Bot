// Everything the main process and the window agree on. Types only: no code runs from this file.

export type Lang = 'ru' | 'en'

// ------------------------------------------------------------------ chat

export interface ChatMessage {
  id: string
  /** When Twitch received it, in milliseconds. */
  ts: number
  channel: string
  login: string
  name: string
  /** The colour the person picked for their name, or '' for none. */
  color: string
  text: string
  mod: boolean
  broadcaster: boolean
  vip: boolean
  sub: boolean
  /** Their first ever message in this channel. */
  first: boolean
  /** A /me message. */
  action: boolean
  emoteOnly: boolean
  /** Set when the message is a Twitch reply to another message. */
  replyTo?: { id: string; login: string }
  /** Written by the signed-in account from somewhere else: the person themself, not the app. */
  self?: boolean
}

export type Trigger = 'mention' | 'question' | 'keyword' | 'streamer' | 'chat'

export type SkipReason =
  | 'self'
  | 'ignored_user'
  | 'command'
  | 'link'
  | 'short'
  | 'emote_only'
  | 'copypaste'
  | 'bot_question'
  | 'blocked_word'
  | 'directed'
  | 'cooldown'
  | 'mention_cooldown'
  | 'user_cooldown'
  | 'hour_cap'
  | 'busy'
  | 'chance'
  | 'paused'
  | 'offline_stream'

/** Why a reply that was started did not reach the chat. */
export type DropReason = 'stale' | 'empty' | 'nothing' | 'garbled' | 'thinking' | 'off_language' | 'refusal' | 'blocked' | 'link' | 'repeat' | 'llm_error' | 'stopped' | 'paused' | 'rejected'

export interface Decision {
  reply: boolean
  trigger: Trigger
  reason?: SkipReason
  /** The chance this message had, 0..1, when it came down to a roll. */
  chance?: number
}

export interface ReplyItem {
  type: 'reply'
  id: string
  ts: number
  text: string
  to: { id: string; login: string; name: string; text: string }
  trigger: Trigger
  /** Which provider and model wrote it, as the router reports it. */
  via: string
  /** How long the model took, in milliseconds. */
  ms: number
  status: 'sent' | 'test' | 'rejected'
  /** For a rejected reply: what Twitch said. */
  note?: string
}

export interface NoteItem {
  type: 'note'
  id: string
  ts: number
  tone: 'info' | 'ok' | 'warn' | 'error'
  /** Both languages, so a note written earlier follows a language switch. */
  ru: string
  en: string
}

export type FeedItem = { type: 'msg'; id: string; ts: number; msg: ChatMessage; picked?: boolean } | ReplyItem | NoteItem

export interface DecisionEntry {
  id: string
  ts: number
  name: string
  text: string
  trigger: Trigger
  outcome: 'reply' | SkipReason | DropReason
  chance?: number
  detail?: string
}

/** One mark on the rhythm strip. */
export interface Beat {
  t: number
  /** m: a message, a: a message addressed to you, r: a reply sent, d: a test reply. */
  k: 'm' | 'a' | 'r' | 'd'
  /** Message length mapped to 0..1. */
  w: number
}

export interface Job {
  id: string
  phase: 'reading' | 'thinking' | 'typing'
  to: { name: string; text: string }
  trigger: Trigger
  text?: string
  via?: string
  startedAt: number
  /** When the message goes out, once that is known. */
  sendAt?: number
}

export type PauseReason = 'you_typed' | 'timeout' | 'banned' | 'room' | 'auto_stop' | 'not_live'

export interface BotStatus {
  state: 'idle' | 'starting' | 'running' | 'error'
  /** Shown under the start button when state is 'error'. */
  error?: { ru: string; en: string }
  /** Replies are written but not sent. Always true without a signed-in account. */
  test: boolean
  anonymous: boolean
  channel: string
  login: string
  twitch: 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'auth_failed'
  room: { slow: number; followersOnly: number; subsOnly: boolean; emoteOnly: boolean }
  stream: { known: boolean; live: boolean; title: string; game: string; viewers: number }
  startedAt: number
  counters: { seen: number; replies: number; tests: number; dropped: number }
  /** Chat messages in the last minute. */
  perMin: number
  /** When the pause after the last reply ends. In the past or 0: ready for the next message. */
  nextWindowAt: number
  /** Replies are held until this moment (0: not held). */
  pausedUntil: number
  pauseReason?: PauseReason
  job: Job | null
  llm: { lastVia: string; lastMs: number; avgMs: number; errors: number; lastError: string }
}

export interface BotSnapshot {
  status: BotStatus
  feed: FeedItem[]
  /** The latest replies, kept apart: in a fast chat they scroll out of the feed within minutes. */
  replies: ReplyItem[]
  decisions: DecisionEntry[]
  beats: Beat[]
}

export type BotEvent =
  | { e: 'feed'; item: FeedItem }
  | { e: 'pick'; id: string }
  | { e: 'decision'; d: DecisionEntry }
  | { e: 'beat'; b: Beat }
  | { e: 'status'; s: BotStatus }

// ------------------------------------------------------------------ settings

export interface Persona {
  /** In the person's own words: how they write. */
  about: string
  /** Lines they really wrote; the model copies the manner. */
  examples: string[]
  lang: 'auto' | Lang
  maxWords: number
  lowercase: boolean
  noPeriod: boolean
  /** How often a reply ends with a closing bracket, 0..100. */
  brackets: number
  emoji: boolean
  /** May it swear when the chat does? Off: the model is told to keep it clean. */
  swearing: boolean
  /** Emotes it may use. Their capital letters are kept. */
  emotes: string[]
  typos: 0 | 1 | 2
  useCustomPrompt: boolean
  customPrompt: string
  /** Collect what the person types in chat themself as more examples. */
  learnFromMe: boolean
  learned: string[]
}

export type PresetId = 'rare' | 'normal' | 'active' | 'turbo'

export interface Behavior {
  preset: PresetId | 'custom'
  minGapSec: number
  maxGapSec: number
  maxPerHour: number
  /** After the pause, the reply goes to one of the messages that arrive within about this long. */
  spreadSec: number
  replyToMentions: boolean
  mentionGapSec: number
  questionBoost: number
  streamerBoost: number
  keywords: string[]
  keywordBoost: number
  /** Other names people call you by in chat. */
  aliases: string[]
  /** Leave alone messages that are addressed to someone else. */
  skipDirected: boolean
  ignoreUsers: string[]
  ignoreCommands: boolean
  ignoreLinks: boolean
  minChars: number
  userCooldownSec: number
  replyMode: 'auto' | 'plain' | 'mention' | 'thread'
  /** How many recent messages the model reads. */
  contextSize: number
  maxChars: number
  typing: 'instant' | 'fast' | 'human' | 'slow'
  /** A reply that would arrive later than this is not sent. */
  maxStaleSec: number
  blocked: string[]
  /** Stay quiet this many minutes after you type in chat yourself. 0: off. */
  pauseWhenITalkMin: number
  /** Stop by itself after this many hours. 0: never. */
  autoStopHours: number
  onlyWhenLive: boolean
  /** Write replies without sending them. */
  test: boolean
}

export interface LlmSettings {
  source: 'builtin' | 'custom'
  model: string
  temperature: number
  maxTokens: number
  timeoutSec: number
  customBaseUrl: string
  customModel: string
  /** The providers that need no key were switched on once already. */
  keylessDone: boolean
}

export interface UiSettings {
  lang: 'auto' | Lang
  theme: string
  /** Light or dark for the Brackets theme. */
  scheme: 'system' | 'light' | 'dark'
  closeToTray: boolean
  startHidden: boolean
  launchAtLogin: boolean
  /** Start replying as soon as the app opens. */
  autoStart: boolean
  /** How many minutes the rhythm strip shows. */
  stripMin: 2 | 5 | 15
  welcomed: boolean
}

export interface TwitchSettings {
  /** The Client ID of an application registered at dev.twitch.tv; needed to sign in. */
  clientId: string
  channel: string
  login: string
  userId: string
  /** When the access token runs out, in milliseconds. 0: unknown. */
  expiresAt: number
  scopes: string[]
  /** The Client ID the current token belongs to. */
  tokenClientId: string
  /** The token was pasted by hand, so it cannot be renewed. */
  manual: boolean
}

export interface Settings {
  v: 1
  ui: UiSettings
  twitch: TwitchSettings
  persona: Persona
  behavior: Behavior
  llm: LlmSettings
}

export type DeepPartial<T> = T extends (infer U)[] ? U[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

// ------------------------------------------------------------------ account

export interface AuthStatus {
  signedIn: boolean
  login: string
  expiresAt: number
  scopes: string[]
  /** The token may write to chat. */
  canChat: boolean
  /** It renews itself. False for a pasted token. */
  renews: boolean
  /** A sign-in is waiting for the code to be entered at twitch.tv/activate. */
  device?: { userCode: string; url: string; expiresAt: number }
  error?: string
}

// ------------------------------------------------------------------ router (FreeLLMAPI)

export interface RouterStatus {
  /** missing: this build has no router bundle (npm run setup was not run). */
  state: 'stopped' | 'starting' | 'ready' | 'failed' | 'missing'
  port: number
  version: string
  error?: string
}

export interface RouterProvider {
  platform: string
  name: string
  kind: 'chat' | 'search'
  keyless: boolean
  configured: boolean
  keyCount: number
  enabledKeyCount: number
}

export interface RouterKey {
  id: number
  platform: string
  label: string
  maskedKey: string
  status: string
  enabled: boolean
}

export interface LlmSample {
  ok: boolean
  text: string
  raw: string
  via: string
  ms: number
  error?: string
}

export interface AppInfo {
  version: string
  routerVersion: string
  electron: string
  locale: string
  dataDir: string
  platform: string
  packaged: boolean
}
