import type { Behavior, Lang, Persona, PresetId, Settings } from './types.ts'

export const APP_NAME = 'Brackets'

/** Who made it. Shown in the sidebar and under Settings → About. */
export const AUTHOR = {
  name: 'MarySue',
  github: 'https://github.com/MarySueXLsD',
  itch: 'https://marysue.itch.io'
}

// Filled in when the app is built (electron.vite.config.ts); absent when this file runs under plain node.
declare const __TWITCH_CLIENT_ID__: string | undefined

/**
 * The Client ID of a Twitch application (https://dev.twitch.tv/console/apps, type: Public) that the
 * build carries, so the person using it does not have to type one. It comes from
 * twitch-client-id.local.txt at build time and is empty in a build made without that file.
 * A Client ID is not a secret.
 */
export const BUILTIN_TWITCH_CLIENT_ID: string = typeof __TWITCH_CLIENT_ID__ === 'string' ? __TWITCH_CLIENT_ID__ : ''

/** Read chat and write to chat; nothing else is asked for. */
export const TWITCH_SCOPES = ['chat:read', 'chat:edit']

/** How often it replies. The pause after each reply is picked at random between the two numbers. */
export const PRESETS: Record<PresetId, Pick<Behavior, 'minGapSec' | 'maxGapSec' | 'maxPerHour'>> = {
  rare: { minGapSec: 360, maxGapSec: 840, maxPerHour: 8 },
  normal: { minGapSec: 120, maxGapSec: 300, maxPerHour: 22 },
  active: { minGapSec: 45, maxGapSec: 120, maxPerHour: 45 },
  turbo: { minGapSec: 15, maxGapSec: 40, maxPerHour: 110 }
}

/** Well-known chat bots: answering them is talking to a wall. */
export const KNOWN_BOTS = [
  'nightbot',
  'streamelements',
  'streamlabs',
  'moobot',
  'fossabot',
  'wizebot',
  'soundalerts',
  'sery_bot',
  'pokemoncommunitygame',
  'botrixoficial',
  'kofistreambot',
  'own3d',
  'commanderroot',
  'tangiabot',
  'streamstickers',
  'creatisbot',
  'songlistbot',
  'frostytoolsdotcom',
  'blerp',
  'dixperbro',
  'jeetbot',
  'deepbot',
  'phantombot',
  'coebot',
  'ankhbot'
]

/** Emotes whose capital letters must survive "all lowercase". */
export const COMMON_EMOTES = ['Kappa', 'KEKW', 'LUL', 'OMEGALUL', 'PogChamp', 'Pog', 'POGGERS', 'monkaS', 'monkaW', 'Sadge', 'Pepega', 'PepeHands', 'FeelsBadMan', 'FeelsGoodMan', 'BibleThump', 'NotLikeThis', 'ResidentSleeper', 'Kreygasm', '4Head', '5Head', 'EZ', 'Clap', 'catJAM', 'peepoHappy', 'WeirdChamp', 'KEKL', 'ICANT', 'Aware', 'Clueless', 'xdd', 'LULW', 'HeyGuys', 'VoHiYo', 'SeemsGood', 'DansGame', 'TriHard', 'WutFace', 'GIGACHAD', 'Bedge', 'Copium', 'Madge', 'modCheck', 'NODDERS', 'NOPERS', 'OMEGADANCE', 'pepeLaugh', 'PauseChamp', 'Prayge', 'Susge', 'YEP', 'NOP']

/** The manner a new profile starts with: plain, a little careless, a bracket for a smile. */
const PERSONA_TEXT: Record<Lang, Pick<Persona, 'about' | 'examples'>> = {
  ru: {
    about: 'пишу просто и немного по-тупому, как в переписке с друзьями: короткие фразы, разговорные словечки (ну, типо, кста, хз, ща, ток, пж), без умных оборотов и без пафоса',
    examples: ['ну типо да)', 'а че так можно было', 'ахах жиза', 'хз вроде норм', 'ща гляну', 'кста да, согласен)', 'ну такое', 'пон)']
  },
  en: {
    about: 'i write plain and a bit lazy, like texting friends: short lines, everyday words (kinda, tbh, idk, ngl, lol), nothing clever and nothing formal',
    examples: ['yeah kinda)', 'wait you can do that', 'lol same', 'idk seems fine', 'one sec gonna check', 'tbh yeah, agreed)', 'eh could be better', 'got it)']
  }
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  ui: {
    lang: 'auto',
    theme: 'brackets',
    scheme: 'dark',
    closeToTray: true,
    startHidden: false,
    launchAtLogin: false,
    autoStart: false,
    stripMin: 5,
    welcomed: false
  },
  twitch: {
    clientId: BUILTIN_TWITCH_CLIENT_ID,
    channel: '',
    login: '',
    userId: '',
    expiresAt: 0,
    scopes: [],
    tokenClientId: '',
    manual: false
  },
  persona: {
    about: PERSONA_TEXT.ru.about,
    examples: PERSONA_TEXT.ru.examples,
    lang: 'auto',
    maxWords: 12,
    lowercase: true,
    noPeriod: true,
    brackets: 45,
    emoji: false,
    swearing: false,
    emotes: [],
    typos: 1,
    useCustomPrompt: false,
    customPrompt: '',
    learnFromMe: true,
    learned: []
  },
  behavior: {
    preset: 'active',
    ...PRESETS.active,
    spreadSec: 20,
    replyToMentions: true,
    mentionGapSec: 12,
    questionBoost: 2,
    streamerBoost: 2,
    keywords: [],
    keywordBoost: 3,
    aliases: [],
    skipDirected: true,
    ignoreUsers: [],
    ignoreCommands: true,
    ignoreLinks: true,
    minChars: 2,
    userCooldownSec: 90,
    replyMode: 'auto',
    contextSize: 14,
    maxChars: 140,
    typing: 'human',
    maxStaleSec: 40,
    blocked: [],
    pauseWhenITalkMin: 3,
    autoStopHours: 0,
    onlyWhenLive: false,
    test: false
  },
  llm: {
    source: 'builtin',
    // FreeLLMAPI's "fastest" routing. Measured on the providers that need no key: about 2 seconds
    // an answer, against 11 for the balanced "auto", which likes large models that think first.
    model: 'auto:fast',
    temperature: 0.9,
    maxTokens: 300,
    timeoutSec: 30,
    customBaseUrl: 'http://127.0.0.1:11434/v1',
    customModel: '',
    keylessDone: false
  }
}

/** The starting manner in the given language. */
export const defaultPersona = (lang: Lang): Persona => ({ ...DEFAULT_SETTINGS.persona, about: PERSONA_TEXT[lang].about, examples: [...PERSONA_TEXT[lang].examples], emotes: [], learned: [] })

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Lay `patch` over `base`: objects merge key by key, everything else (arrays too) is replaced. */
export function merge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = key in base ? merge((base as Record<string, unknown>)[key], value) : value
  }
  return out as T
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.min(hi, Math.max(lo, v))
}
const words = (list: unknown, max: number, len: number): string[] =>
  (Array.isArray(list) ? list : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max)

/** Settings read from disk or sent by the window: fill what is missing, keep numbers in range. */
export function sanitizeSettings(input: unknown): Settings {
  const s = merge(DEFAULT_SETTINGS, isObject(input) ? input : {})
  const d = DEFAULT_SETTINGS
  const b = s.behavior
  b.minGapSec = clamp(b.minGapSec, 5, 3600, d.behavior.minGapSec)
  b.maxGapSec = clamp(b.maxGapSec, b.minGapSec, 7200, Math.max(b.minGapSec, d.behavior.maxGapSec))
  b.maxPerHour = clamp(b.maxPerHour, 1, 240, d.behavior.maxPerHour)
  b.spreadSec = clamp(b.spreadSec, 3, 180, d.behavior.spreadSec)
  b.mentionGapSec = clamp(b.mentionGapSec, 2, 600, d.behavior.mentionGapSec)
  b.questionBoost = clamp(b.questionBoost, 1, 6, d.behavior.questionBoost)
  b.streamerBoost = clamp(b.streamerBoost, 1, 6, d.behavior.streamerBoost)
  b.keywordBoost = clamp(b.keywordBoost, 1, 6, d.behavior.keywordBoost)
  b.minChars = clamp(b.minChars, 1, 40, d.behavior.minChars)
  b.userCooldownSec = clamp(b.userCooldownSec, 0, 3600, d.behavior.userCooldownSec)
  b.contextSize = Math.round(clamp(b.contextSize, 0, 40, d.behavior.contextSize))
  b.maxChars = Math.round(clamp(b.maxChars, 20, 450, d.behavior.maxChars))
  b.maxStaleSec = clamp(b.maxStaleSec, 8, 300, d.behavior.maxStaleSec)
  b.pauseWhenITalkMin = clamp(b.pauseWhenITalkMin, 0, 120, d.behavior.pauseWhenITalkMin)
  b.autoStopHours = clamp(b.autoStopHours, 0, 48, d.behavior.autoStopHours)
  b.keywords = words(b.keywords, 60, 40)
  b.aliases = words(b.aliases, 20, 30)
  b.ignoreUsers = words(b.ignoreUsers, 200, 30).map((x) => x.replace(/^@/, '').toLowerCase())
  b.blocked = words(b.blocked, 200, 40)
  if (!['auto', 'plain', 'mention', 'thread'].includes(b.replyMode)) b.replyMode = d.behavior.replyMode
  if (!['instant', 'fast', 'human', 'slow'].includes(b.typing)) b.typing = d.behavior.typing
  if (!['rare', 'normal', 'active', 'turbo', 'custom'].includes(b.preset)) b.preset = 'custom'

  const p = s.persona
  p.about = String(p.about ?? '').slice(0, 1200)
  p.examples = words(p.examples, 40, 200)
  p.learned = words(p.learned, 30, 200)
  p.emotes = words(p.emotes, 60, 30)
  p.maxWords = Math.round(clamp(p.maxWords, 2, 40, d.persona.maxWords))
  p.brackets = Math.round(clamp(p.brackets, 0, 100, d.persona.brackets))
  p.typos = ([0, 1, 2] as const).includes(p.typos) ? p.typos : d.persona.typos
  p.customPrompt = String(p.customPrompt ?? '').slice(0, 6000)
  p.swearing = p.swearing === true
  if (!['auto', 'ru', 'en'].includes(p.lang)) p.lang = 'auto'

  const l = s.llm
  l.temperature = clamp(l.temperature, 0, 2, d.llm.temperature)
  l.maxTokens = Math.round(clamp(l.maxTokens, 32, 2000, d.llm.maxTokens))
  l.timeoutSec = clamp(l.timeoutSec, 5, 120, d.llm.timeoutSec)
  l.model = String(l.model || d.llm.model).slice(0, 120)
  l.customBaseUrl = String(l.customBaseUrl ?? '').trim().slice(0, 300)
  l.customModel = String(l.customModel ?? '').trim().slice(0, 120)
  if (l.source !== 'custom') l.source = 'builtin'

  s.twitch.channel = String(s.twitch.channel ?? '').slice(0, 60)
  // An empty box means "the one the app came with".
  s.twitch.clientId = String(s.twitch.clientId ?? '').trim().slice(0, 60) || BUILTIN_TWITCH_CLIENT_ID
  if (!['auto', 'ru', 'en'].includes(s.ui.lang)) s.ui.lang = 'auto'
  if (!['system', 'light', 'dark'].includes(s.ui.scheme)) s.ui.scheme = 'dark'
  if (![2, 5, 15].includes(s.ui.stripMin)) s.ui.stripMin = 5
  s.v = 1
  return s
}
