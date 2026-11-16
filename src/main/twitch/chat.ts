// The connection to Twitch chat: an encrypted IRC socket that joins one channel, reads every line,
// and comes back by itself when the network drops. Without a token it joins as an anonymous guest,
// which may read but not write.
import { EventEmitter } from 'node:events'
import tls from 'node:tls'
import { parseIrcLine, privmsg, toChatMessage, REFUSALS, type IrcLine } from '@core/irc'
import type { BotStatus, ChatMessage } from '@shared/types'

const HOST = 'irc.chat.twitch.tv'
const PORT = 6697

export type ChatState = BotStatus['twitch']

export interface ChatEvents {
  state: [ChatState]
  joined: [string]
  message: [ChatMessage]
  /** Twitch refused something or has something to say; id is its msg-id tag ('' when it has none). */
  notice: [{ id: string; text: string }]
  room: [BotStatus['room']]
  /** The signed-in account was timed out (seconds) or banned (0) in the channel. */
  punished: [number]
  authfail: []
  log: [string]
}

export class TwitchChat extends EventEmitter<ChatEvents> {
  state: ChatState = 'offline'
  room: BotStatus['room'] = { slow: 0, followersOnly: -1, subsOnly: false, emoteOnly: false }
  /** True for a moderator or the broadcaster: Twitch lets them write faster. */
  privileged = false

  private socket: tls.TLSSocket | null = null
  private want: { login: string; token: string; channel: string } | null = null
  private buffer = ''
  private attempt = 0
  private retry: NodeJS.Timeout | null = null
  private watchdog: NodeJS.Timeout | null = null
  private lastData = 0
  private pinged = 0
  private sends: number[] = []
  private joinedOnce = false

  get anonymous(): boolean {
    return !this.want?.token
  }

  connect(login: string, token: string, channel: string): void {
    this.disconnect()
    this.want = { login: token ? login : `justinfan${10000 + Math.floor(Math.random() * 80000)}`, token, channel }
    this.attempt = 0
    this.open()
  }

  disconnect(): void {
    this.want = null
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.close()
    this.setState('offline')
  }

  private close(): void {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    const s = this.socket
    this.socket = null
    if (s) {
      s.removeAllListeners()
      s.on('error', () => undefined)
      s.destroy()
    }
    this.buffer = ''
  }

  private setState(state: ChatState): void {
    if (this.state === state) return
    this.state = state
    this.emit('state', state)
  }

  private open(): void {
    const want = this.want
    if (!want) return
    this.close()
    this.joinedOnce = false
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const socket = tls.connect({ host: HOST, port: PORT, servername: HOST })
    this.socket = socket
    socket.setEncoding('utf8')
    socket.setKeepAlive(true, 30000)
    socket.once('secureConnect', () => {
      this.lastData = Date.now()
      this.raw('CAP REQ :twitch.tv/tags twitch.tv/commands')
      if (want.token) this.raw(`PASS oauth:${want.token}`)
      this.raw(`NICK ${want.login}`)
    })
    socket.on('data', (chunk: string) => this.onData(chunk))
    socket.once('error', (err) => {
      this.emit('log', `chat socket error: ${err.message}`)
      this.lost()
    })
    socket.once('close', () => this.lost())
    // Twitch pings every few minutes. Long silence means the connection died without saying so.
    this.watchdog = setInterval(() => {
      const quiet = Date.now() - this.lastData
      if (this.pinged && Date.now() - this.pinged > 15000 && quiet > 15000) return this.lost()
      if (quiet > 6 * 60 * 1000 && !this.pinged) {
        this.pinged = Date.now()
        this.raw('PING :brackets')
      }
    }, 5000)
  }

  private lost(): void {
    if (!this.want || this.socket === null) return
    this.close()
    if (this.state === 'auth_failed') return
    this.setState('reconnecting')
    // 1, 2, 4 ... 30 seconds, with a little noise so many clients do not return in the same instant.
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt, 5)) * (0.75 + Math.random() * 0.5)
    this.attempt++
    if (this.retry) clearTimeout(this.retry)
    this.retry = setTimeout(() => this.open(), delay)
  }

  private raw(line: string): void {
    const s = this.socket
    if (s && !s.destroyed) s.write(line + '\r\n')
  }

  private onData(chunk: string): void {
    this.lastData = Date.now()
    this.pinged = 0
    this.buffer += chunk
    let at: number
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const text = this.buffer.slice(0, at)
      this.buffer = this.buffer.slice(at + 1)
      const line = parseIrcLine(text)
      if (line) this.onLine(line)
    }
    // A line this long is not chat; do not let it grow without end.
    if (this.buffer.length > 65536) this.buffer = ''
  }

  private onLine(line: IrcLine): void {
    const want = this.want
    if (!want) return
    switch (line.command) {
      case 'PING':
        this.raw(`PONG :${line.trailing}`)
        return
      case '001':
        this.attempt = 0
        this.raw(`JOIN #${want.channel}`)
        return
      case 'RECONNECT':
        // Twitch is about to restart this server and asks clients to move.
        this.emit('log', 'Twitch asked to reconnect')
        this.lost()
        return
      case 'NOTICE': {
        const text = line.trailing
        if (/login authentication failed|improperly formatted auth|login unsuccessful/i.test(text)) {
          this.close()
          this.setState('auth_failed')
          this.emit('authfail')
          return
        }
        this.emit('notice', { id: line.tags['msg-id'] ?? '', text })
        return
      }
      case 'ROOMSTATE': {
        const t = line.tags
        // A change sends only the tag that changed, so keep what is not mentioned.
        if ('slow' in t) this.room.slow = Number(t.slow) || 0
        if ('followers-only' in t) this.room.followersOnly = Number(t['followers-only'])
        if ('subs-only' in t) this.room.subsOnly = t['subs-only'] === '1'
        if ('emote-only' in t) this.room.emoteOnly = t['emote-only'] === '1'
        this.emit('room', { ...this.room })
        if (!this.joinedOnce) {
          this.joinedOnce = true
          this.setState('connected')
          this.emit('joined', want.channel)
        }
        return
      }
      case 'USERSTATE': {
        const badges = line.tags.badges ?? ''
        this.privileged = line.tags.mod === '1' || /(?:^|,)(?:broadcaster|moderator|vip)\//.test(badges)
        return
      }
      case 'CLEARCHAT':
        // With a name: that person was timed out or banned. Without: the whole chat was cleared.
        if (line.trailing && line.trailing.toLowerCase() === want.login) this.emit('punished', Number(line.tags['ban-duration']) || 0)
        return
      case 'PRIVMSG': {
        const message = toChatMessage(line)
        if (message) this.emit('message', message)
        return
      }
      default:
        return
    }
  }

  /** How many messages may still go out in the current 30 seconds. */
  private budget(): number {
    const now = Date.now()
    this.sends = this.sends.filter((t) => now - t < 30000)
    // Twitch allows 20 per 30 seconds (100 for moderators); stay well under it.
    return (this.privileged ? 80 : 15) - this.sends.length
  }

  /** Send one line to the channel. False when it could not go out (offline, guest, too many at once). */
  say(text: string, replyToId?: string): boolean {
    const want = this.want
    if (!want || !want.token || this.state !== 'connected' || this.budget() <= 0) return false
    const line = privmsg(want.channel, text, replyToId)
    if (line.endsWith(' :')) return false
    this.sends.push(Date.now())
    this.raw(line)
    return true
  }
}

/** What a refusal means in words, and whether replies should be held because of it. */
export const explainNotice = (id: string): (typeof REFUSALS)[string] | undefined => REFUSALS[id]
