// Signing in to Twitch without ever seeing the password: the app shows a short code, the person
// enters it at twitch.tv/activate in their own browser, and Twitch hands the app a token that may
// read and write chat. That token renews itself; a token pasted by hand does not.
import { shell } from 'electron'
import { EventEmitter } from 'node:events'
import { TWITCH_SCOPES } from '@shared/defaults'
import type { AuthStatus } from '@shared/types'
import type { Store } from '../store'

const ID = 'https://id.twitch.tv/oauth2'
const HELIX = 'https://api.twitch.tv/helix'

export interface TokenInfo {
  clientId: string
  login: string
  userId: string
  scopes: string[]
  expiresIn: number
}

async function post(url: string, form: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15000)
  })
  let body: any = {}
  try {
    body = await res.json()
  } catch {
    /* an empty or non-JSON answer */
  }
  return { status: res.status, body }
}

/** Who a token belongs to, or null when Twitch no longer accepts it. Throws when Twitch cannot be reached. */
export async function validate(token: string): Promise<TokenInfo | null> {
  const res = await fetch(`${ID}/validate`, { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(15000) })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Twitch answered ${res.status}`)
  const b = (await res.json()) as any
  return { clientId: String(b.client_id ?? ''), login: String(b.login ?? '').toLowerCase(), userId: String(b.user_id ?? ''), scopes: Array.isArray(b.scopes) ? b.scopes : [], expiresIn: Number(b.expires_in) || 0 }
}

/** Is the channel live, and what is on? null when that cannot be told (no token, a network error). */
export async function streamInfo(token: string, clientId: string, channel: string): Promise<{ live: boolean; title: string; game: string; viewers: number } | null> {
  try {
    const res = await fetch(`${HELIX}/streams?user_login=${encodeURIComponent(channel)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId },
      signal: AbortSignal.timeout(12000)
    })
    if (!res.ok) return null
    const b = (await res.json()) as any
    const s = Array.isArray(b.data) ? b.data[0] : undefined
    if (!s) return { live: false, title: '', game: '', viewers: 0 }
    return { live: s.type === 'live', title: String(s.title ?? ''), game: String(s.game_name ?? ''), viewers: Number(s.viewer_count) || 0 }
  } catch {
    return null
  }
}

const canChat = (scopes: string[]): boolean => scopes.includes('chat:edit')

export class Auth extends EventEmitter {
  private store: Store
  private device: { userCode: string; url: string; expiresAt: number; code: string; clientId: string; cancelled: boolean } | null = null
  private error = ''
  private timer: NodeJS.Timeout | null = null
  private refreshing: Promise<string> | null = null

  constructor(store: Store) {
    super()
    this.store = store
  }

  status(): AuthStatus {
    const t = this.store.get().twitch
    const signedIn = Boolean(t.login && this.store.secret('twitch.access'))
    return {
      signedIn,
      login: signedIn ? t.login : '',
      expiresAt: signedIn ? t.expiresAt : 0,
      scopes: signedIn ? t.scopes : [],
      canChat: signedIn && canChat(t.scopes),
      renews: signedIn && !t.manual && Boolean(this.store.secret('twitch.refresh')),
      ...(this.device ? { device: { userCode: this.device.userCode, url: this.device.url, expiresAt: this.device.expiresAt } } : {}),
      ...(this.error ? { error: this.error } : {})
    }
  }

  private changed(): void {
    this.emit('changed', this.status())
  }

  /** Twitch asks apps to check their token every hour; this also renews it before it runs out. */
  startKeeping(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.check(), 55 * 60 * 1000)
    void this.check()
  }

  private async check(): Promise<void> {
    const token = this.store.secret('twitch.access')
    if (!token) return
    try {
      const info = await validate(token)
      if (!info) {
        // Refused: renew it if that is possible, otherwise the person has to sign in again.
        if (!(await this.renew())) this.forget('expired')
        return
      }
      this.remember(info, this.store.get().twitch.manual)
      if (info.expiresIn < 2 * 3600) await this.renew()
    } catch {
      // No network right now. The token is probably fine; the next check will tell.
    }
  }

  private remember(info: TokenInfo, manual: boolean): void {
    this.store.patch({ twitch: { login: info.login, userId: info.userId, scopes: info.scopes, tokenClientId: info.clientId, expiresAt: info.expiresIn ? Date.now() + info.expiresIn * 1000 : 0, manual } })
    this.error = ''
    this.changed()
  }

  private forget(error = ''): void {
    this.store.setSecret('twitch.access', '')
    this.store.setSecret('twitch.refresh', '')
    this.store.patch({ twitch: { login: '', userId: '', scopes: [], tokenClientId: '', expiresAt: 0, manual: false } })
    this.error = error
    this.changed()
  }

  /** Trade the refresh token for a new access token. Returns the new token, or '' when that failed. */
  private renew(): Promise<string> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      const t = this.store.get().twitch
      const refresh = this.store.secret('twitch.refresh')
      const clientId = t.tokenClientId || t.clientId
      if (!refresh || !clientId || t.manual) return ''
      try {
        const { status, body } = await post(`${ID}/token`, { grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId })
        if (status !== 200 || !body.access_token) return ''
        this.store.setSecret('twitch.access', String(body.access_token))
        // Each refresh token works once; Twitch sends the next one along.
        if (body.refresh_token) this.store.setSecret('twitch.refresh', String(body.refresh_token))
        this.store.patch({ twitch: { expiresAt: Date.now() + (Number(body.expires_in) || 0) * 1000, scopes: Array.isArray(body.scope) ? body.scope : t.scopes } })
        this.changed()
        return String(body.access_token)
      } catch {
        return ''
      }
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  /** A token that is good right now, or '' when nobody is signed in. */
  async token(): Promise<string> {
    const token = this.store.secret('twitch.access')
    if (!token) return ''
    const t = this.store.get().twitch
    if (t.expiresAt && t.expiresAt - Date.now() < 10 * 60 * 1000) return (await this.renew()) || token
    return token
  }

  /** Chat refused the token. Try to renew it once; returns the new token or ''. */
  async rejected(): Promise<string> {
    const renewed = await this.renew()
    if (!renewed) this.forget('expired')
    return renewed
  }

  async startDevice(): Promise<AuthStatus> {
    const clientId = this.store.get().twitch.clientId.trim()
    if (!clientId) {
      this.error = 'no_client_id'
      return this.status()
    }
    this.cancelDevice()
    this.error = ''
    try {
      const { status, body } = await post(`${ID}/device`, { client_id: clientId, scopes: TWITCH_SCOPES.join(' ') })
      if (status !== 200 || !body.device_code) {
        this.error = status === 400 || status === 404 ? 'bad_client_id' : `twitch_${status}`
        this.changed()
        return this.status()
      }
      const device = { userCode: String(body.user_code), url: String(body.verification_uri), expiresAt: Date.now() + (Number(body.expires_in) || 1800) * 1000, code: String(body.device_code), clientId, cancelled: false }
      this.device = device
      this.changed()
      // Only ever a Twitch address, checked before it goes to the browser.
      if (/^https:\/\/(www\.)?twitch\.tv\//.test(device.url)) void shell.openExternal(device.url)
      void this.poll(device, Math.max(3, Number(body.interval) || 5))
    } catch {
      this.error = 'network'
      this.changed()
    }
    return this.status()
  }

  private async poll(device: NonNullable<Auth['device']>, interval: number): Promise<void> {
    let wait = interval
    while (!device.cancelled && Date.now() < device.expiresAt) {
      await new Promise((r) => setTimeout(r, wait * 1000))
      if (device.cancelled) return
      try {
        const { status, body } = await post(`${ID}/token`, { client_id: device.clientId, scopes: TWITCH_SCOPES.join(' '), device_code: device.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
        if (status === 200 && body.access_token) {
          const info = await validate(String(body.access_token))
          if (device.cancelled) return
          if (!info) break
          this.store.setSecret('twitch.access', String(body.access_token))
          this.store.setSecret('twitch.refresh', String(body.refresh_token ?? ''))
          this.device = null
          this.remember(info, false)
          // The channel to sit in defaults to the person's own.
          if (!this.store.get().twitch.channel) this.store.patch({ twitch: { channel: info.login } })
          return
        }
        const message = String(body.message ?? '')
        if (message === 'slow_down') wait += 5
        else if (message !== 'authorization_pending') {
          this.error = message === 'access_denied' ? 'denied' : message.includes('expired') || message.includes('invalid device code') ? 'code_expired' : `twitch_${status}`
          break
        }
      } catch {
        // A network hiccup: keep waiting.
      }
    }
    if (this.device === device) {
      this.device = null
      if (!this.error && !device.cancelled) this.error = 'code_expired'
      this.changed()
    }
  }

  cancelDevice(): AuthStatus {
    if (this.device) this.device.cancelled = true
    this.device = null
    this.changed()
    return this.status()
  }

  /** Sign in with a token made elsewhere. It works until it runs out and cannot be renewed. */
  async setToken(raw: string): Promise<AuthStatus> {
    const token = String(raw ?? '').trim().replace(/^oauth:/i, '')
    if (!/^[a-z0-9]{20,60}$/i.test(token)) {
      this.error = 'bad_token'
      this.changed()
      return this.status()
    }
    try {
      const info = await validate(token)
      if (!info || !info.login) {
        this.error = 'bad_token'
        this.changed()
        return this.status()
      }
      this.cancelDevice()
      this.store.setSecret('twitch.access', token)
      this.store.setSecret('twitch.refresh', '')
      this.remember(info, true)
      if (!this.store.get().twitch.channel) this.store.patch({ twitch: { channel: info.login } })
    } catch {
      this.error = 'network'
      this.changed()
    }
    return this.status()
  }

  async signOut(): Promise<AuthStatus> {
    const token = this.store.secret('twitch.access')
    const t = this.store.get().twitch
    this.cancelDevice()
    this.forget()
    // Tell Twitch the token is no longer wanted. If that fails it still runs out on its own.
    if (token && t.tokenClientId) void post(`${ID}/revoke`, { client_id: t.tokenClientId, token }).catch(() => undefined)
    return this.status()
  }
}
