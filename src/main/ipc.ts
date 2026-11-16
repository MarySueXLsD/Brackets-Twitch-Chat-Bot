// Answers every call the window can make (the list is src/shared/channels.ts).
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { ALLOWED_LINKS, API_CHANNELS as C } from '@shared/channels'
import { normalizeChannel } from '@core/irc'
import type { AppInfo, AuthStatus, DeepPartial, Settings } from '@shared/types'
import type { Bot } from './bot'
import { listModels } from './llm'
import type { Router } from './router'
import type { Store } from './store'

/** The sign-in as the window uses it: the real one, or the demo's. */
export interface AccountApi {
  status(): AuthStatus
  startDevice(): Promise<AuthStatus>
  cancelDevice(): AuthStatus
  setToken(token: string): Promise<AuthStatus>
  signOut(): Promise<AuthStatus>
  on(event: 'changed', cb: (status: AuthStatus) => void): unknown
}

export interface Deps {
  store: Store
  auth: AccountApi
  router: Router
  bot: Bot
  window: () => BrowserWindow | null
  applyStartup: () => void
  quit: () => void
}

export function registerIpc(d: Deps): void {
  const { store, auth, router, bot } = d
  const send = (channel: string, payload: unknown): void => {
    const w = d.window()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
  // Only the app's own window may call in.
  const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (e.sender !== d.window()?.webContents) throw new Error('not allowed')
      return fn(...args)
    })
  }

  store.on('changed', (s: Settings) => send(C.settings.onChanged, s))
  auth.on('changed', (s) => send(C.auth.onChanged, s))
  router.on('status', (s) => send(C.router.onStatus, s))
  bot.on('events', (batch) => send(C.bot.onEvents, batch))

  handle(C.settings.get, () => store.get())
  handle(C.settings.set, (patch: DeepPartial<Settings>) => {
    const before = store.get()
    const channelBefore = normalizeChannel(before.twitch.channel)
    const sourceBefore = `${before.llm.source}|${before.llm.customBaseUrl}`
    const after = store.patch(patch ?? {})
    if (patch?.ui && ('launchAtLogin' in patch.ui || 'startHidden' in patch.ui)) d.applyStartup()
    // A different channel or model server means a different connection.
    if (normalizeChannel(after.twitch.channel) !== channelBefore || `${after.llm.source}|${after.llm.customBaseUrl}` !== sourceBefore) void bot.restart()
    return after
  })
  handle(C.settings.reset, (section: 'persona' | 'behavior' | 'llm') => (['persona', 'behavior', 'llm'].includes(section) ? store.reset(section) : store.get()))

  handle(C.bot.start, () => bot.start())
  handle(C.bot.stop, () => bot.stop())
  handle(C.bot.snapshot, () => bot.snapshot())
  handle(C.bot.replyNow, () => bot.replyNow())
  handle(C.bot.resume, () => bot.resume())
  handle(C.bot.clearFeed, () => bot.clearFeed())

  handle(C.auth.status, () => auth.status())
  handle(C.auth.startDevice, () => auth.startDevice())
  handle(C.auth.cancelDevice, () => auth.cancelDevice())
  handle(C.auth.setToken, (token: string) => auth.setToken(token))
  handle(C.auth.signOut, async () => {
    const status = await auth.signOut()
    // Signed out means guest: reconnect that way if it is running.
    void bot.restart()
    return status
  })

  handle(C.router.status, () => router.status())
  handle(C.router.restart, () => router.restart())
  handle(C.router.providers, () => router.providers())
  handle(C.router.keys, () => router.keys())
  handle(C.router.addKey, (platform: string, key: string, label?: string) => router.addKey(String(platform), String(key ?? '').trim(), String(label ?? '')))
  handle(C.router.removeKey, (id: number) => router.removeKey(Number(id)))
  handle(C.router.logs, () => router.logs())
  handle(C.router.openDashboard, async () => {
    await router.openDashboard()
  })
  handle(C.router.models, async () => {
    const l = store.get().llm
    if (l.source === 'custom') return listModels(l.customBaseUrl, store.secret('llm.customKey'))
    const e = router.endpoint()
    return e ? listModels(e.baseUrl, e.apiKey) : []
  })

  handle(C.llm.sample, (message: string, count: number) => bot.sample(String(message ?? ''), Number(count) || 1))
  handle(C.llm.prompt, (message: string) => bot.promptPreview(String(message ?? '')))
  handle(C.llm.setCustomKey, (key: string) => store.setSecret('llm.customKey', String(key ?? '').trim()))
  handle(C.llm.hasCustomKey, () => Boolean(store.secret('llm.customKey')))

  handle(C.app.info, (): AppInfo => ({ version: app.getVersion(), routerVersion: router.version, electron: process.versions.electron, locale: app.getLocale(), dataDir: store.dir, platform: process.platform, packaged: app.isPackaged }))
  handle(C.app.openExternal, (url: string) => {
    // The window can only open the addresses the app itself links to.
    if (typeof url === 'string' && ALLOWED_LINKS.some((prefix) => url.startsWith(prefix))) return shell.openExternal(url)
    return undefined
  })
  handle(C.app.openDataDir, () => shell.openPath(store.dir))
  handle(C.app.chrome, (colors: { color: string; symbolColor: string }) => {
    const w = d.window()
    if (!w || process.platform === 'darwin') return
    if (!/^#[0-9a-f]{6}$/i.test(colors?.color ?? '') || !/^#[0-9a-f]{6}$/i.test(colors?.symbolColor ?? '')) return
    try {
      w.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 40 })
      w.setBackgroundColor(colors.color)
    } catch {
      /* not every system has an overlay to colour */
    }
  })
  handle(C.app.quit, () => d.quit())
}
