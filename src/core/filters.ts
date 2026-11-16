// What a model wrote is not yet a chat message. This file turns one into the other, or refuses it.
import type { DropReason, Lang } from '../shared/types.ts'
import { cleanOutgoing } from './irc.ts'

export interface SanitizeOptions {
  maxChars: number
  lowercase: boolean
  noPeriod: boolean
  emoji: boolean
  /** Words that must keep their capital letters (emotes). */
  keepCase: string[]
  blocked: string[]
  ownLogin: string
  /** The language the reply should be in. A Russian reply with no Russian letters is not one. */
  lang?: Lang
  /** The message being answered. A reply that quotes it back is talk about the task, not a reply. */
  target?: { name: string; text: string }
}

export type SanitizeResult = { ok: true; text: string } | { ok: false; reason: DropReason }

// JavaScript's \b only knows Latin letters: it never fires next to a Cyrillic one. These two stand
// in for it wherever Russian text is matched.
const B = '(?<![\\p{L}\\p{N}_])'
const E = '(?![\\p{L}\\p{N}_])'
const word = (body: string): RegExp => new RegExp(`${B}(?:${body})${E}`, 'iu')

const LINK = /(?:https?:\/\/|www\.)\S+|(?<![\p{L}\p{N}])[a-z0-9][a-z0-9-]{1,62}\.(?:com|net|org|ru|tv|gg|io|me|ly|cc|co|su|xyz|app|dev|info|link|site|online|store|shop|top|club|pro|рф)(?![\p{L}\p{N}])(?:\/\S*)?/iu

/** Things an assistant says and a person in chat never does. */
const REFUSAL = [
  word("as an? (?:ai|artificial intelligence|language model|assistant)"),
  word("(?:i am|i'm) (?:an? )?(?:ai|artificial intelligence|language model|chat ?bot|virtual assistant)"),
  word("i (?:can(?:no|')t|cannot|am unable to|'m unable to|won't be able to) (?:help|assist|comply|provide|fulfil+|do that|generate|create|write|respond|answer)"),
  word("i(?:'m| am) sorry,? but"),
  word('how can i (?:help|assist) you'),
  word('я\\s*(?:—|-|–)?\\s*(?:ии|искусственный интеллект|языковая модель|нейросеть|бот|чат-?бот|виртуальный ассистент|ассистент)'),
  word('как (?:ии|искусственный интеллект|языковая модель|нейросеть|ассистент)'),
  word('(?:извините|простите|к сожалению),? (?:но )?я не могу'),
  word('я не могу (?:помочь|выполнить|ответить на (?:этот|такой) запрос|создать|написать (?:это|такое))'),
  word('чем (?:я )?могу (?:вам |тебе )?помочь')
]

// Anchored to the start of the line by hand: \W would walk straight over Cyrillic letters.
const START = '^[^\\p{L}\\p{N}]*'

/**
 * A model thinking out loud instead of answering: "Thinking Process:", "Okay, the user wants...",
 * "1. **Analyze the request**". Some free models print this in place of the reply.
 */
const THINKING = [
  // A label and a colon where the reply should begin.
  new RegExp(`${START}(?:thinking(?: process)?|thought process|thoughts|reasoning|analysis|chain of thought|step[- ]by[- ]step|final answer|draft|размышлени[ея]|рассуждени[ея]|анализ|ход мыслей|итоговый ответ|черновик)\\s*[:：]`, 'iu'),
  // The same label after a few words: "Here's a thinking process:", "Вот мой ход мыслей:".
  new RegExp(`${START}(?:[\\p{L}']+\\s+){1,4}(?:thinking process|thought process|reasoning|chain of thought|ход мыслей|размышлени[ея]|рассуждени[ея])\\s*[:：]`, 'iu'),
  // Talking about the task instead of doing it.
  new RegExp(`${START}(?:(?:okay|ok|alright|hmm|well),? )?(?:let me (?:think|see|analy[sz]e|break)|let's (?:think|analy[sz]e|break)|first,? (?:i need|let me|let's|we need)|(?:i|we) need to (?:respond|reply|answer|write|craft|come up|figure)|i should (?:respond|reply|answer|write|keep it)|the user (?:is|wants|asks|asked|said|says|wrote|message)|the (?:task|instruction|prompt) (?:is|says|asks))`, 'iu'),
  new RegExp(`${START}(?:(?:хорошо|ладно|итак|так),? )?(?:пользователь (?:просит|спрашивает|написал|пишет|хочет)|мне (?:нужно|надо) (?:ответить|написать|придумать)|нужно (?:ответить|написать) (?:как|в стиле|коротко|от лица)|давай(?:те)? (?:подумаем|разбер[её]м))`, 'iu'),
  // "1. **Analyze the request**"
  /^\s*\d+\.\s+\*\*/
]

/**
 * Talk about the job rather than a line of chat, wherever it stands in the answer. Seen live:
 * "We need answer in Russian as viewer. User asks: respond to someone: «...» need only".
 */
// Words a model uses about its task and a viewer does not use in chat. One alone can be chance.
const META_RU = [
  /ответить на (?:последнее |это )?сообщени/iu,
  /(?:мы|я) (?:должны|должен|должна) /iu,
  /нужно (?:ответить|написать)/iu,
  /обычн(?:ый|ого|ым) зрител/iu,
  /twitch[- ]?чат/iu,
  /зрител[ья] (?:в|из) чат/iu,
  /без (?:кавычек|ника|пояснений)/iu,
  /коротко,? по теме/iu,
  /в (?:стиле|манере) /iu,
  /пользовател[ья]/iu
]

const META = [
  /\b(?:the user|user (?:asks|asked|says|said|wants|wrote|is asking|message|query)|respond(?:ing)? to (?:the|this|\w+:)|(?:we|i) need (?:to )?(?:answer|respond|reply|write|output|produce)|need only|system prompt|my instructions|as (?:a |an )?(?:viewer|chatter)\b[^.]*\b(?:need|should|must|answer|respond))\b/i,
  word('пользователь (?:просит|спрашивает|написал|пишет|хочет)|системн(?:ый|ого|ом) промпт|мо(?:и|их|им) инструкци(?:и|й|ям)')
]
export const isThinking = (text: string): boolean => THINKING.some((r) => r.test(text)) || META.some((r) => r.test(text)) || META_RU.filter((r) => r.test(text)).length >= 2

/** A word that mixes Latin and Cyrillic letters ("hе", "приvет"): a small model falling apart. */
export const isGarbled = (text: string): boolean => text.split(/[^\p{L}]+/u).some((w) => /[A-Za-z]/.test(w) && /[\u0400-\u04FF]/.test(w))

export const hasLink = (text: string): boolean => LINK.test(text)
export const isRefusal = (text: string): boolean => REFUSAL.some((r) => r.test(text))

/** Letters and digits only, lower case: two replies with the same key read as the same message. */
export const dedupeKey = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Is this message talking to `login` (or one of the other names they go by)? */
export function mentions(text: string, login: string, aliases: string[] = []): boolean {
  const names = [login, ...aliases].map((n) => n.trim()).filter((n) => n.length >= 2)
  if (!names.length) return false
  // A name counts when it stands as a word of its own: "bob" is not in "bobby".
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])@?(?:${names.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`, 'iu')
  return re.test(text)
}

/** The name a message is addressed to when it opens with "@name", else ''. */
export function addressedTo(text: string): string {
  const m = /^\s*@([A-Za-z0-9_]{2,25})\b/.exec(text)
  return m ? m[1].toLowerCase() : ''
}

export function containsBlocked(text: string, blocked: string[]): boolean {
  if (!blocked.length) return false
  const low = text.toLowerCase()
  return blocked.some((w) => {
    const word = w.trim().toLowerCase()
    return word.length > 0 && low.includes(word)
  })
}

const QUESTION_WORDS = new RegExp(`^(?:кто|что|чт[оё]|че|чё|шо|как|какой|какая|какие|какое|где|куда|откуда|когда|почему|зачем|сколько|чей|можно|а можно|who|what|whats|what's|why|how|when|where|which|whose|is|are|do|does|did|can|could|should|will|would)${E}`, 'iu')

// "а когда турнир", "ну и как оно": the question word comes after a filler or two.
const FILLERS = new RegExp(`^(?:(?:а|ну|и|так|эй|слушай|слушайте|блин|кста|кстати|ребят|ребята|чат|народ|so|and|hey|yo|ok|okay|guys|chat)${E}[\\s,]*)+`, 'iu')

export function isQuestion(text: string): boolean {
  const s = text.trim()
  if (s.includes('?')) return true
  const start = s.replace(/^@\S+\s*,?\s*/, '')
  return QUESTION_WORDS.test(start) || QUESTION_WORDS.test(start.replace(FILLERS, ''))
}

// Laughter and other one-breath reactions, as whole words.
const LAUGH = new RegExp(
  '^(?:[ахпэы]{3,}|[axh]{3,}|(?:ха|хе|хи|хо|ах|ых|ha|he|hi|ah)+[хh]?|а+(?:ха+)+х*|л+[оу]+л+ы?|lo+l+|lmf?ao+|rofl|ке+к+и?|ke+k+w?|xd+|хд+|ор+у+|ржу+|ы{2,}|гг|gg|wp|ez|кек[вw]?)$',
  'iu'
)

/**
 * A message with nothing in it to answer: laughter, "lol", "+", an emote, a single word. Picking
 * one makes the reply look as if it were talking to itself ("ааххаха" answered with a statement).
 * A question is never a reaction, however short.
 */
export function isReaction(text: string): boolean {
  if (text.includes('?')) return false
  const tokens = text
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
  const said = tokens.filter((t) => !LAUGH.test(t) && /\p{L}{2,}/u.test(t))
  // Fewer than two real words: a reaction, whatever the word is.
  return said.length < 2
}

const BOT_WORD = '(?:бот|бота|ботом|ботик|ботяра|нейросеть|нейросетка|нейронка|ии|робот|чатгпт|bot|ai|gpt|chatgpt|llm|robot)'
const ASKS_IF_BOT = [
  // "ты бот?", "ты что, бот", "ты случайно не нейросеть"
  word(`(?:ты|вы)[\\s,]+(?:(?:что|чё|че|шо|реально|точно|случайно|не|ли)[\\s,]+){0,3}${BOT_WORD}`),
  word(`(?:are|r)\\s+(?:you|u)\\s+(?:(?:really|actually|even|just)\\s+)?(?:an?\\s+)?(?:real\\s+)?${BOT_WORD}`),
  word(`(?:you|u)(?:'re| are)\\s+(?:an?\\s+)?${BOT_WORD}`)
]
/**
 * Is someone asking whether this account is a bot? The app does not answer that: a made-up "no"
 * would be a lie told in the owner's name, so the question is left for the owner.
 * `addressed`: the message is aimed at this account, so a bare "бот?" counts too.
 */
export function asksIfBot(text: string, addressed = false): boolean {
  if (ASKS_IF_BOT.some((r) => r.test(text))) return true
  return addressed && text.includes('?') && word(BOT_WORD).test(text)
}

/** How many letters and digits a message has: "))))" and "!!!" have none. */
export const letterCount = (text: string): number => (text.match(/[\p{L}\p{N}]/gu) ?? []).length

/** Letters only: "67" and "+1" are votes, not something to talk about. */
export const wordLetters = (text: string): number => (text.match(/\p{L}/gu) ?? []).length

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{200D}\u{FE0F}\u{20E3}]/gu

/** Cut reasoning blocks some models print before the answer. */
function stripThinking(raw: string): string {
  let s = raw.replace(/<(think|thinking|reasoning|analysis)>[\s\S]*?<\/\1>/gi, '')
  // An unclosed block: everything after the tag is thinking, nothing is an answer.
  s = s.replace(/<(think|thinking|reasoning|analysis)>[\s\S]*$/i, '')
  return s
}

function lowerExcept(text: string, keep: string[]): string {
  if (!keep.length) return text.toLowerCase()
  const kept = new Map(keep.map((w) => [w.toLowerCase(), w]))
  return text
    .split(/(\s+)/)
    .map((token) => {
      const bare = token.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, '')
      const original = kept.get(bare.toLowerCase())
      // An emote only renders with its exact capitals, so "kekw" from the model becomes "KEKW".
      return original ? token.replace(bare, original) : token.toLowerCase()
    })
    .join('')
}

/** Turn raw model output into one clean chat line, or say why it cannot be sent. */
export function sanitizeReply(raw: string, o: SanitizeOptions): SanitizeResult {
  const lines = stripThinking(String(raw ?? '')).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (!lines.length) return { ok: false, reason: 'empty' }
  // The model may pass: it is told to answer with this one word when there is nothing to say.
  if (/^[^\p{L}]*(?:пропуск|skip|pass)[^\p{L}]*$/iu.test(lines[0])) return { ok: false, reason: 'nothing' }
  if (isThinking(lines[0])) return { ok: false, reason: 'thinking' }
  // One line only. A line that ends with a colon is a heading ("Ответ:"), so the reply is the one
  // under it; if nothing is, there is no reply.
  let s = lines.find((l) => !/[:：]$/.test(l)) ?? ''
  if (!s) return { ok: false, reason: 'empty' }
  if (isThinking(s)) return { ok: false, reason: 'thinking' }

  // "nick: text", "Ответ: text", list bullets, quote marks and markdown around the whole thing.
  const own = o.ownLogin ? escapeRe(o.ownLogin) + '|' : ''
  s = s.replace(/^(?:>+|[-*•]+)\s*/, '')
  s = s.replace(new RegExp(`^@?(?:${own}ответ|сообщение|reply|response|answer|output|message|assistant|chat)(?:\\s*\\((?:ты|you)\\))?\\s*[:—–-]\\s+`, 'iu'), '')
  // "я: ..." is a label, "я - не знаю" is a sentence: only the colon counts for the short ones.
  s = s.replace(/^(?:me|you|я|ты)(?:\s*\((?:ты|you)\))?\s*:\s+/iu, '')
  s = s.replace(/^["'`«»“”„‚‘’]+|["'`«»“”„‚‘’]+$/g, '').trim()
  s = s.replace(/(\*\*|__|~~|`)/g, '').replace(/^#+\s*/, '')

  if (isRefusal(s)) return { ok: false, reason: 'refusal' }
  if (hasLink(s)) return { ok: false, reason: 'link' }

  // The app adds the @name itself when a reply needs one; anything else must not ping people.
  s = s.replace(/^(?:@[A-Za-z0-9_]{2,25}[,:]?\s+)+/, '').replace(/@/g, '')
  if (!o.emoji) s = s.replace(EMOJI, '')
  if (o.lowercase) s = lowerExcept(s, o.keepCase)
  if (o.noPeriod) s = s.replace(/(?<![.…])\.$/, '')
  s = cleanOutgoing(s)

  if (s.length > o.maxChars) {
    const cut = s.slice(0, o.maxChars)
    const space = cut.lastIndexOf(' ')
    s = (space > o.maxChars * 0.5 ? cut.slice(0, space) : cut).replace(/[,;:\s-]+$/, '')
  }
  if (!letterCount(s) && !/[)(]/.test(s)) return { ok: false, reason: 'empty' }
  if (isGarbled(s)) return { ok: false, reason: 'garbled' }
  if (o.target) {
    // "...respond to nick: «the message»": the task read back, with the message quoted inside it.
    const low = s.toLowerCase()
    const quoted = o.target.text.trim().toLowerCase()
    if (low.includes(`${o.target.name.toLowerCase()}:`) || /«[^»]{12,}»/.test(s)) return { ok: false, reason: 'thinking' }
    if (quoted.length >= 8 && low.includes(quoted) && low.length > quoted.length + 12) return { ok: false, reason: 'thinking' }
  }
  // A long answer without one Russian letter in a Russian chat is the model talking to itself in
  // English. Short Latin lines ("gg wp", "KEKW") are ordinary chat and pass.
  if (o.lang === 'ru') {
    const latin = (s.match(/[A-Za-z]/g) ?? []).length
    const cyrillic = (s.match(/[\u0400-\u04FF]/g) ?? []).length
    if (latin > 24 && latin > cyrillic * 1.2) return { ok: false, reason: 'off_language' }
  }
  if (containsBlocked(s, o.blocked)) return { ok: false, reason: 'blocked' }
  return { ok: true, text: s }
}

/**
 * The closing bracket some people use as a smile: "ну да)". With the given chance (0..100) the
 * reply ends with one, sometimes two or three.
 */
export function addBrackets(text: string, chance: number, rng: () => number = Math.random): string {
  if (chance <= 0 || /[)(]\s*$/.test(text)) return text
  // A question smiles less often.
  const p = (chance / 100) * (/\?\s*$/.test(text) ? 0.35 : 1)
  if (rng() >= p) return text
  const roll = rng()
  const tail = roll < 0.62 ? ')' : roll < 0.92 ? '))' : ')))'
  return text.replace(/[.!\s]+$/, '') + tail
}
