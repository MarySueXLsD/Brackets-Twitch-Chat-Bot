// The typed face of the bridge that src/preload/index.ts puts on window.brackets.
import type { AppInfo, AuthStatus, BotEvent, BotSnapshot, DeepPartial, LlmSample, RouterKey, RouterProvider, RouterStatus, Settings } from '@shared/types'

type Off = () => void

export interface Bridge {
  settings: {
    get(): Promise<Settings>
    set(patch: DeepPartial<Settings>): Promise<Settings>
    reset(section: 'persona' | 'behavior' | 'llm'): Promise<Settings>
    onChanged(cb: (s: Settings) => void): Off
  }
  bot: {
    start(): Promise<void>
    stop(): Promise<void>
    snapshot(): Promise<BotSnapshot>
    replyNow(): Promise<boolean>
    resume(): Promise<void>
    clearFeed(): Promise<void>
    onEvents(cb: (batch: BotEvent[]) => void): Off
  }
  auth: {
    status(): Promise<AuthStatus>
    startDevice(): Promise<AuthStatus>
    cancelDevice(): Promise<AuthStatus>
    setToken(token: string): Promise<AuthStatus>
    signOut(): Promise<AuthStatus>
    onChanged(cb: (s: AuthStatus) => void): Off
  }
  router: {
    status(): Promise<RouterStatus>
    restart(): Promise<boolean>
    providers(): Promise<RouterProvider[]>
    keys(): Promise<RouterKey[]>
    addKey(platform: string, key: string, label?: string): Promise<{ modelsAvailable: number; notice: string }>
    removeKey(id: number): Promise<void>
    models(): Promise<string[]>
    logs(): Promise<string[]>
    openDashboard(): Promise<void>
    onStatus(cb: (s: RouterStatus) => void): Off
  }
  llm: {
    sample(message: string, count: number): Promise<LlmSample[]>
    prompt(message: string): Promise<{ system: string; user: string }>
    setCustomKey(key: string): Promise<void>
    hasCustomKey(): Promise<boolean>
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openDataDir(): Promise<void>
    chrome(colors: { color: string; symbolColor: string }): Promise<void>
    quit(): Promise<void>
  }
}

declare global {
  interface Window {
    brackets: Bridge
  }
}

export const api: Bridge = window.brackets
