// Twitch chat speaks IRC with tags. This file reads and writes its lines; it opens no connection.
import type { ChatMessage } from '../shared/types.ts'

export interface IrcLine {
  raw: string
  tags: Record<string, string>
  prefix: string
  /** The part of the prefix before "!": who sent it. */
  nick: string
  command: string
  params: string[]
  trailing: string
}

const TAG_ESCAPES: Record<string, string> = { ':': ';', s: ' ', '\\': '\\', r: '\r', n: '\n' }

export function unescapeTag(value: string): string {
  if (!value.includes('\\')) return value
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = value[++i]
    // A lone backslash at the end is dropped, as the IRCv3 rules say.
    if (next !== undefined) out += TAG_ESCAPES[next] ?? next
  }
  return out
}

export function parseIrcLine(raw: string): IrcLine | null {
  let s = raw.replace(/[\r\n]+$/, '')
  if (!s) return null
  const tags: Record<string, string> = {}
  if (s[0] === '@') {
    const sp = s.indexOf(' ')
    if (sp < 0) return null
    for (const part of s.slice(1, sp).split(';')) {
      if (!part) continue
      const eq = part.indexOf('=')
      if (eq < 0) tags[part] = ''
      else tags[part.slice(0, eq)] = unescapeTag(part.slice(eq + 1))
    }
    s = s.slice(sp + 1).trimStart()
  }
  let prefix = ''
  if (s[0] === ':') {
    const sp = s.indexOf(' ')
    if (sp < 0) return null
    prefix = s.slice(1, sp)
    s = s.slice(sp + 1).trimStart()
  }
  let trailing = ''
  let head = s
  const ti = s.indexOf(' :')
  if (ti >= 0) {
    trailing = s.slice(ti + 2)
    head = s.slice(0, ti)
  }
  const parts = head.split(' ').filter(Boolean)
  const command = (parts.shift() ?? '').toUpperCase()
  if (!command) return null
  const bang = prefix.indexOf('!')
  return { raw, tags, prefix, nick: bang >= 0 ? prefix.slice(0, bang) : prefix, command, params: parts, trailing }
}

const hasBadge = (badges: string, name: string): boolean => badges.split(',').some((b) => b.split('/')[0] === name)

/** A chat line (PRIVMSG) as a message; null for anything else. */
export function toChatMessage(line: IrcLine, now = Date.now()): ChatMessage | null {
  if (line.command !== 'PRIVMSG' || !line.params[0]) return null
  const t = line.tags
  let text = line.trailing
  let action = false
  // "/me does something" travels as a CTCP ACTION.
  const m = /^\u0001ACTION ([\s\S]*?)\u0001?$/.exec(text)
  if (m) {
    action = true
    text = m[1]
  }
  const login = (line.nick || t.login || '').toLowerCase()
  if (!login) return null
  const badges = t.badges ?? ''
  const sent = Number(t['tmi-sent-ts'])
  return {
    id: t.id || `${login}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Number.isFinite(sent) && sent > 0 ? sent : now,
    channel: line.params[0].replace(/^#/, '').toLowerCase(),
    login,
    name: t['display-name'] || login,
    color: /^#[0-9a-f]{6}$/i.test(t.color ?? '') ? t.color : '',
    text: text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(),
    mod: t.mod === '1' || hasBadge(badges, 'moderator'),
    broadcaster: hasBadge(badges, 'broadcaster'),
    vip: hasBadge(badges, 'vip'),
    sub: t.subscriber === '1' || hasBadge(badges, 'subscriber') || hasBadge(badges, 'founder'),
    first: t['first-msg'] === '1',
    action,
    emoteOnly: t['emote-only'] === '1',
    ...(t['reply-parent-msg-id'] ? { replyTo: { id: t['reply-parent-msg-id'], login: (t['reply-parent-user-login'] ?? '').toLowerCase() } } : {})
  }
}

/** "#Name", "name" or a twitch.tv link → the channel's login, or '' when it cannot be one. */
export function normalizeChannel(input: string): string {
  let s = (input ?? '').trim()
  const url = /twitch\.tv\/(?:popout\/)?([A-Za-z0-9_]+)/i.exec(s)
  if (url) s = url[1]
  s = s.replace(/^[#@]/, '').toLowerCase()
  return /^[a-z0-9][a-z0-9_]{0,24}$/.test(s) ? s : ''
}

/**
 * Text that is safe to put after "PRIVMSG #channel :". One line, no control characters, and never a
 * chat command: Twitch runs a message that starts with "/" or "." as a command (/ban, .timeout),
 * and channel bots answer "!". A model must not be able to trigger any of those.
 */
export function cleanOutgoing(text: string, max = 480): string {
  let s = (text ?? '').replace(/[\u0000-\u001f\u007f\u{2028}\u{2029}]/gu, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/^[\s/.!\\]+/, '')
  if (s.length > max) s = s.slice(0, max).trimEnd()
  return s
}

/** The line that sends `text` to a channel, optionally as a Twitch reply to another message. */
export function privmsg(channel: string, text: string, replyToId?: string): string {
  const safe = cleanOutgoing(text)
  const reply = replyToId && /^[0-9a-f-]{8,64}$/i.test(replyToId) ? `@reply-parent-msg-id=${replyToId} ` : ''
  return `${reply}PRIVMSG #${channel} :${safe}`
}

/** Messages Twitch sends when it refuses a chat line, by their msg-id tag. */
export const REFUSALS: Record<string, { ru: string; en: string; hold?: 'timeout' | 'banned' | 'room' }> = {
  msg_banned: { ru: 'Аккаунт забанен в этом чате', en: 'This account is banned from the chat', hold: 'banned' },
  msg_timedout: { ru: 'Аккаунт в тайм-ауте в этом чате', en: 'This account is timed out in the chat', hold: 'timeout' },
  msg_followersonly: { ru: 'Чат только для фолловеров', en: 'The chat is for followers only', hold: 'room' },
  msg_followersonly_zero: { ru: 'Чат только для фолловеров', en: 'The chat is for followers only', hold: 'room' },
  msg_followersonly_followed: { ru: 'Фоллов слишком недавний для этого чата', en: 'The follow is too recent for this chat', hold: 'room' },
  msg_subsonly: { ru: 'Чат только для подписчиков', en: 'The chat is for subscribers only', hold: 'room' },
  msg_emoteonly: { ru: 'В чате режим «только эмоуты»', en: 'The chat is in emote-only mode', hold: 'room' },
  msg_slowmode: { ru: 'Медленный режим: сообщение отправлено слишком рано', en: 'Slow mode: the message came too early' },
  msg_r9k: { ru: 'Сообщение слишком похоже на предыдущее', en: 'The message is too similar to an earlier one' },
  msg_duplicate: { ru: 'Такое же сообщение уже было отправлено', en: 'The same message was sent a moment ago' },
  msg_ratelimit: { ru: 'Слишком много сообщений подряд', en: 'Too many messages in a row' },
  msg_rejected: { ru: 'Сообщение отправлено на проверку модераторам', en: 'The message is held for moderators to review' },
  msg_rejected_mandatory: { ru: 'Сообщение не прошло фильтры канала', en: 'The message did not pass the channel filters' },
  msg_verified_email: { ru: 'Чат требует подтверждённую почту', en: 'The chat needs a verified email', hold: 'room' },
  msg_requires_verified_phone_number: { ru: 'Чат требует подтверждённый телефон', en: 'The chat needs a verified phone number', hold: 'room' },
  msg_channel_suspended: { ru: 'Канал недоступен', en: 'The channel is unavailable', hold: 'room' },
  msg_suspended: { ru: 'Аккаунт заблокирован', en: 'The account is suspended', hold: 'banned' },
  msg_bad_characters: { ru: 'В сообщении недопустимые символы', en: 'The message has characters Twitch does not accept' },
  msg_facebook: { ru: 'Сообщение отклонено', en: 'The message was refused' }
}
