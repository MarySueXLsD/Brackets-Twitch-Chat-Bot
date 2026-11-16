// When to reply. Not to every message: after each reply there is a pause, then one of the next
// messages is picked. Being called by name is answered sooner. No timers and no clock in here:
// the caller passes the time in, so the rules can be tested on their own.
import type { Behavior, ChatMessage, Decision, SkipReason, Trigger } from '../shared/types.ts'
import { KNOWN_BOTS } from '../shared/defaults.ts'
import { addressedTo, asksIfBot, containsBlocked, hasLink, isQuestion, isReaction, mentions, wordLetters } from './filters.ts'

export interface PacerContext {
  now: number
  ownLogin: string
  /** Chat messages per minute right now. */
  perMin: number
  /** A reply is already being written. */
  busy: boolean
  /** Replies are held (you typed yourself, a timeout, ...). */
  paused: boolean
  /** Seconds between messages the channel enforces (slow mode). */
  slow: number
  /** How many of the recent messages say the very same thing as this one. */
  repeats?: number
}

export function classify(msg: ChatMessage, b: Behavior, ownLogin: string): Trigger {
  if (ownLogin && (msg.replyTo?.login === ownLogin || mentions(msg.text, ownLogin, b.aliases))) return 'mention'
  if (b.keywords.length && containsBlocked(msg.text, b.keywords)) return 'keyword'
  if (isQuestion(msg.text)) return 'question'
  if (msg.broadcaster) return 'streamer'
  return 'chat'
}

/** Why this message is never answered, whatever the timing; undefined when it may be. */
export function ineligible(msg: ChatMessage, b: Behavior, ownLogin: string, trigger: Trigger, repeats = 0): SkipReason | undefined {
  if (msg.self || (ownLogin && msg.login === ownLogin)) return 'self'
  if (KNOWN_BOTS.includes(msg.login) || b.ignoreUsers.includes(msg.login)) return 'ignored_user'
  // "!drops", "/me", ".timeout": bot commands. "..." is just someone trailing off.
  if (b.ignoreCommands && /^\s*(?:[!/]\S|\.[a-z])/i.test(msg.text)) return 'command'
  if (b.ignoreLinks && hasLink(msg.text)) return 'link'
  if (msg.emoteOnly) return 'emote_only'
  if (wordLetters(msg.text) < b.minChars) return 'short'
  // The chat is chanting the same line ("67", a copypasta): joining in or answering it is noise.
  if (repeats >= 2 && trigger !== 'mention') return 'copypaste'
  if (containsBlocked(msg.text, b.blocked)) return 'blocked_word'
  if (asksIfBot(msg.text, trigger === 'mention')) return 'bot_question'
  if (b.skipDirected && trigger !== 'mention') {
    // "@someone ..." and Twitch replies to other people are a conversation between those two.
    const to = msg.replyTo?.login || addressedTo(msg.text)
    if (to && to !== ownLogin) return 'directed'
  }
  return undefined
}

/**
 * The chance for one message once the pause is over. It is set so that a reply lands within about
 * `spreadSec`, however fast the chat is: a busy chat gives each message a small chance, a slow one
 * answers the first message that comes. Without it the reply would always go to the first message
 * after the pause, which reads as a machine.
 */
export function pickChance(perMin: number, spreadSec: number, boost: number): number {
  const expected = Math.max(1, (perMin * spreadSec) / 60)
  return Math.min(1, (1 / expected) * boost)
}

export class Pacer {
  /** The pause after the last reply ends at this moment. 0: nothing sent yet, ready at once. */
  nextWindowAt = 0
  private lastMentionReplyAt = -Infinity
  private sent: number[] = []
  private perUser = new Map<string, number>()
  private rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
  }

  reset(): void {
    this.nextWindowAt = 0
    this.lastMentionReplyAt = -Infinity
    this.sent = []
    this.perUser.clear()
  }

  /** Replies sent within the last hour. */
  sentLastHour(now: number): number {
    this.sent = this.sent.filter((t) => now - t < 3_600_000)
    return this.sent.length
  }

  consider(msg: ChatMessage, b: Behavior, c: PacerContext): Decision {
    const trigger = classify(msg, b, c.ownLogin)
    const no = (reason: SkipReason, chance?: number): Decision => ({ reply: false, trigger, reason, ...(chance === undefined ? {} : { chance }) })

    const blocked = ineligible(msg, b, c.ownLogin, trigger, c.repeats ?? 0)
    if (blocked) return no(blocked)
    if (c.paused) return no('paused')
    if (c.busy) return no('busy')
    if (this.sentLastHour(c.now) >= b.maxPerHour) return no('hour_cap')

    const lastToUser = this.perUser.get(msg.login)
    const mention = trigger === 'mention' && b.replyToMentions
    // Someone who calls you by name twice in a row still gets a short breather, not the full one.
    const userGap = (mention ? Math.min(b.userCooldownSec, b.mentionGapSec) : b.userCooldownSec) * 1000
    if (lastToUser !== undefined && c.now - lastToUser < userGap) return no('user_cooldown')

    if (mention) {
      const gap = Math.max(b.mentionGapSec, c.slow) * 1000
      if (c.now - this.lastMentionReplyAt < gap) return no('mention_cooldown')
      return { reply: true, trigger, chance: 1 }
    }

    if (c.now < this.nextWindowAt) return no('cooldown')
    // A laugh or a one-word reaction can be answered, but a message with something in it is the better pick.
    const boost = trigger === 'question' ? b.questionBoost : trigger === 'keyword' ? b.keywordBoost : trigger === 'streamer' ? b.streamerBoost : isReaction(msg.text) ? 0.5 : 1
    const chance = pickChance(c.perMin, b.spreadSec, boost)
    return this.rng() < chance ? { reply: true, trigger, chance } : no('chance', chance)
  }

  /** A reply went out (or would have, in test mode): start the next pause. */
  onReply(now: number, trigger: Trigger, login: string, b: Behavior, slow = 0): void {
    this.sent.push(now)
    this.perUser.set(login, now)
    if (this.perUser.size > 500) {
      for (const [user, t] of this.perUser) if (now - t > 3_600_000) this.perUser.delete(user)
    }
    if (trigger === 'mention') this.lastMentionReplyAt = now
    const min = Math.max(b.minGapSec, slow)
    const max = Math.max(b.maxGapSec, min)
    // Answering a mention does not buy a full pause, but two messages in a row would look odd.
    const gap = trigger === 'mention' ? Math.min(min, 20) : min + this.rng() * (max - min)
    this.nextWindowAt = Math.max(this.nextWindowAt, now + gap * 1000)
  }

  /** A reply was dropped before sending: look for another message soon, without a full pause. */
  onDrop(now: number): void {
    this.nextWindowAt = Math.max(this.nextWindowAt, now + 4000)
  }
}

/** How long a person would take to read the message and type the reply, in milliseconds. */
export function typingDelay(mode: Behavior['typing'], incoming: string, reply: string, rng: () => number = Math.random): number {
  if (mode === 'instant') return 0
  // Characters typed per second, and seconds spent reading and thinking.
  const [cps, think] = mode === 'fast' ? [11, 0.6] : mode === 'slow' ? [4.5, 2.2] : [7, 1.2]
  const read = Math.min(2.5, incoming.length / 45)
  const type = reply.length / (cps * (0.8 + rng() * 0.4))
  const total = (think * (0.6 + rng() * 0.8) + read + type) * 1000
  return Math.round(Math.min(mode === 'slow' ? 22000 : 13000, Math.max(700, total)))
}
