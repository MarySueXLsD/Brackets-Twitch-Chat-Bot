// Runs the built-in FreeLLMAPI router as a child process and speaks to it: starts it, restarts it
// when it dies, hands out its address and key, and manages provider keys through its own admin API.
// The router's server lives in out/router/router.mjs (see router/host.ts and scripts/build-router.mjs).
import { app, BrowserWindow, ipcMain, shell, utilityProcess, type UtilityProcess } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { RouterKey, RouterProvider, RouterStatus } from '@shared/types'

interface Ready {
  port: number
  unifiedKey: string
  sessionToken: string
}

// In an installed copy the router files sit outside the app archive (asarUnpack in electron-builder.yml).
const unpacked = (p: string): string => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

export class Router extends EventEmitter {
  private child: UtilityProcess | null = null
  private ready: Ready | null = null
  private state: RouterStatus['state'] = 'stopped'
  private error = ''
  private log: string[] = []
  private waiters: Array<(ok: boolean) => void> = []
  private stopping = false
  private crashes: number[] = []
  private sessionWaiters: Array<(token: string) => void> = []
  private dashboard: BrowserWindow | null = null
  private dir = unpacked(path.join(__dirname, '..', 'router'))
  /**
   * Gives the key the router encrypts provider keys with. Set by the app so that the key is kept by
   * Windows for the current user instead of in a file beside the database it protects.
   */
  encryptionKey: (() => string) | null = null

  get version(): string {
    try {
      return String(JSON.parse(readFileSync(path.join(this.dir, 'version.json'), 'utf8')).tag ?? '').replace(/^v/, '')
    } catch {
      return ''
    }
  }

  /** False in a checkout where `npm run setup` has not built the router yet. */
  get built(): boolean {
    return existsSync(path.join(this.dir, 'router.mjs'))
  }

  status(): RouterStatus {
    return { state: this.state, port: this.ready?.port ?? 0, version: this.version, ...(this.error ? { error: this.error } : {}) }
  }

  logs(): string[] {
    return this.log.slice(-200)
  }

  /** Where chat requests go, and the key they need. Null until the router is up. */
  endpoint(): { baseUrl: string; apiKey: string } | null {
    return this.ready ? { baseUrl: `http://127.0.0.1:${this.ready.port}/v1`, apiKey: this.ready.unifiedKey } : null
  }

  private set(state: RouterStatus['state'], error = ''): void {
    this.state = state
    this.error = error
    this.emit('status', this.status())
    if (state === 'ready' || state === 'failed' || state === 'missing' || state === 'stopped') {
      const ok = state === 'ready'
      for (const w of this.waiters.splice(0)) w(ok)
    }
  }

  private keep(chunk: unknown): void {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue
      this.log.push(line.length > 500 ? line.slice(0, 500) + '…' : line)
    }
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400)
  }

  /** Start the router if it is not running. Resolves true once it answers. */
  start(): Promise<boolean> {
    if (this.state === 'ready') return Promise.resolve(true)
    const waiting = new Promise<boolean>((resolve) => this.waiters.push(resolve))
    if (this.state === 'starting') return waiting

    const entry = path.join(this.dir, 'router.mjs')
    if (!existsSync(entry)) {
      this.set('missing', 'out/router/router.mjs is missing. Run: npm run setup')
      return waiting
    }
    const data = path.join(app.getPath('userData'), 'router')
    mkdirSync(data, { recursive: true })
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
    // The server only runs its database migrations when this is not "development", and only makes
    // its own encryption key (kept in a file beside the database) when it is not "production".
    delete env.NODE_ENV
    delete env.ELECTRON_RUN_AS_NODE
    // A database that already has its key in a file beside it keeps using that file: handing it a
    // different key would make every stored provider key unreadable.
    const key = existsSync(path.join(data, '.encryption-key')) ? '' : (this.encryptionKey?.() ?? '')
    if (/^[0-9a-f]{64}$/.test(key)) env.ENCRYPTION_KEY = key
    else delete env.ENCRYPTION_KEY
    Object.assign(env, {
      BRACKETS_ROUTER_DB: path.join(data, 'freeapi.db'),
      BRACKETS_ROUTER_CLIENT: path.join(this.dir, 'client'),
      BRACKETS_ROUTER_PORT: '31517',
      // Points at a file that does not exist: the server must not pick up a stray .env.
      FREEAPI_ENV_PATH: path.join(data, 'none.env'),
      FREEAPI_VERSION: this.version,
      FREEAPI_DB_DIR_HARDENING: '1'
    })

    this.stopping = false
    this.ready = null
    this.set('starting')
    const child = utilityProcess.fork(entry, [], { serviceName: 'Brackets router', stdio: 'pipe', env })
    this.child = child
    child.stdout?.on('data', (c) => this.keep(c))
    child.stderr?.on('data', (c) => this.keep(c))
    child.on('message', (m: any) => {
      if (m?.type === 'ready') {
        this.ready = { port: Number(m.port), unifiedKey: String(m.unifiedKey), sessionToken: String(m.sessionToken) }
        this.set('ready')
        // The router fetches its catalogue a few seconds after starting, so look again after that.
        for (const wait of [4000, 30000]) setTimeout(() => void this.tidyModels(), wait)
      } else if (m?.type === 'session') {
        if (this.ready) this.ready.sessionToken = String(m.sessionToken)
        for (const w of this.sessionWaiters.splice(0)) w(String(m.sessionToken))
      } else if (m?.type === 'failed') {
        this.error = String(m.error ?? 'failed to start')
      }
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      this.ready = null
      if (this.stopping) return this.set('stopped')
      this.keep(`[brackets] router exited with code ${code}`)
      // Come back after a crash, but give up when it keeps dying: three times within two minutes.
      const now = Date.now()
      this.crashes = this.crashes.filter((t) => now - t < 120000)
      this.crashes.push(now)
      if (this.crashes.length >= 3) return this.set('failed', this.error || `The router stopped (code ${code})`)
      this.set('stopped')
      setTimeout(() => {
        if (!this.stopping && !this.child) void this.start()
      }, 1500)
    })
    return waiting
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.dashboard?.close()
    const child = this.child
    if (!child) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, 2500)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      // Lets the server close its database cleanly.
      child.postMessage({ type: 'stop' })
    })
  }

  async restart(): Promise<boolean> {
    await this.stop()
    this.crashes = []
    return this.start()
  }

  private freshSession(): Promise<string> {
    return new Promise((resolve) => {
      if (!this.child) return resolve('')
      const timer = setTimeout(() => resolve(''), 4000)
      this.sessionWaiters.push((token) => {
        clearTimeout(timer)
        resolve(token)
      })
      this.child.postMessage({ type: 'session' })
    })
  }

  /** A call to the router's admin API (the same one its dashboard uses). */
  private async admin<T>(pathname: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
    if (!this.ready) throw new Error('The router is not running')
    const res = await fetch(`http://127.0.0.1:${this.ready.port}/api${pathname}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${this.ready.sessionToken}`, ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15000)
    })
    if (res.status === 401 && retry && (await this.freshSession())) return this.admin<T>(pathname, init, false)
    const text = await res.text()
    let body: any = null
    try {
      body = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new Error(String(body?.error?.message ?? body?.message ?? `HTTP ${res.status}`))
    return body as T
  }

  async providers(): Promise<RouterProvider[]> {
    const r = await this.admin<{ providers: RouterProvider[] }>('/keys/providers')
    return r.providers ?? []
  }

  async keys(): Promise<RouterKey[]> {
    const r = await this.admin<any>('/keys')
    const list: any[] = Array.isArray(r) ? r : (r?.keys ?? [])
    return list.map((k) => ({ id: Number(k.id), platform: String(k.platform), label: String(k.label ?? ''), maskedKey: String(k.maskedKey ?? k.masked_key ?? ''), status: String(k.status ?? 'unknown'), enabled: k.enabled !== false && k.enabled !== 0 }))
  }

  async addKey(platform: string, key: string, label = ''): Promise<{ modelsAvailable: number; notice: string }> {
    const r = await this.admin<any>('/keys', { method: 'POST', body: { platform, ...(key ? { key } : {}), ...(label ? { label } : {}) } })
    return { modelsAvailable: Number(r?.modelsAvailable) || 0, notice: String(r?.notice ?? '') }
  }

  async removeKey(id: number): Promise<void> {
    await this.admin(`/keys/${id}`, { method: 'DELETE' })
  }

  /**
   * Switch off the models that are not for talking. The free catalogue lists moderation models
   * ("…Guard…") among the chat ones, and being small they win the "fastest" race; they answer
   * every request with a verdict such as "Safety: Safe". They can be switched back on in the dashboard.
   */
  async tidyModels(): Promise<number> {
    let off = 0
    try {
      const list = await this.admin<any>('/models')
      const models: any[] = Array.isArray(list) ? list : (list?.models ?? [])
      for (const m of models) {
        if (!m?.enabled || !/guard|moderation|safety|classif/i.test(`${m.modelId ?? ''} ${m.displayName ?? ''}`)) continue
        try {
          await this.admin(`/models/${m.id}`, { method: 'PATCH', body: { enabled: false } })
          off++
        } catch {
          /* one model that will not switch off must not stop the rest */
        }
      }
    } catch {
      /* the router is restarting; the next call tries again */
    }
    if (off) this.keep(`[brackets] switched off ${off} moderation model(s): they do not chat`)
    return off
  }

  /** Some providers answer without any key. Switch them on so the app works before a key is added. */
  async enableKeyless(): Promise<number> {
    let added = 0
    for (const p of await this.providers()) {
      if (!p.keyless || p.kind !== 'chat' || p.configured) continue
      try {
        await this.addKey(p.platform, '')
        added++
      } catch {
        /* one provider refusing must not stop the rest */
      }
    }
    return added
  }

  /** Open FreeLLMAPI's own dashboard in a window, already signed in. Returns the window. */
  async openDashboard(parent?: BrowserWindow): Promise<BrowserWindow | null> {
    if (!(await this.start()) || !this.ready) return null
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.dashboard.show()
      this.dashboard.focus()
      return this.dashboard
    }
    const origin = `http://127.0.0.1:${this.ready.port}`
    const token = (await this.freshSession()) || this.ready.sessionToken
    const win = new BrowserWindow({
      width: 1180,
      height: 800,
      minWidth: 720,
      minHeight: 480,
      title: 'FreeLLMAPI',
      autoHideMenuBar: true,
      backgroundColor: '#111114',
      ...(parent ? { parent } : {}),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'dashboard.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:freellmapi',
        additionalArguments: [`--freeapi-token=${token}`, `--freeapi-version=${this.version}`]
      }
    })
    this.dashboard = win
    // The window shows the router's pages and nothing else; every other link opens in the browser.
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(origin + '/')) {
        e.preventDefault()
        if (/^https:\/\//.test(url)) void shell.openExternal(url)
      }
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.on('closed', () => {
      if (this.dashboard === win) this.dashboard = null
    })
    await win.loadURL(origin + '/')
    return win
  }

  /** The dashboard page asks for a new session when its own runs out. */
  registerDashboardBridge(): void {
    ipcMain.handle('dashboard:session', async (e) => {
      if (!this.dashboard || e.sender !== this.dashboard.webContents) return ''
      return this.freshSession()
    })
  }
}

export const router = new Router()
