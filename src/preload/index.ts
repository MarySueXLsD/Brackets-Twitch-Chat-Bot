import { contextBridge, ipcRenderer } from 'electron'
import { API_CHANNELS } from '@shared/channels'

const invoke =
  (channel: string) =>
  (...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args)

const on =
  (channel: string) =>
  (cb: (payload: unknown) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }

const api = Object.fromEntries(
  Object.entries(API_CHANNELS).map(([group, members]) => [
    group,
    Object.fromEntries(Object.entries(members).map(([name, channel]) => [name, /^on[A-Z]/.test(name) ? on(channel) : invoke(channel)]))
  ])
)

contextBridge.exposeInMainWorld('brackets', api)
