// The bridge for the FreeLLMAPI dashboard window, which shows a page served by the embedded router.
// It does what FreeLLMAPI's own desktop app does (desktop/src/preload.ts there): sign the page in as
// the hidden local account before any of its scripts run, so no login form ever shows.
import { contextBridge, ipcRenderer } from 'electron'

const TOKEN_KEY = 'freellmapi_dashboard_token'
const arg = process.argv.find((a) => a.startsWith('--freeapi-token='))
if (arg) {
  try {
    window.localStorage.setItem(TOKEN_KEY, arg.slice('--freeapi-token='.length))
  } catch {
    // Without storage the dashboard shows its login screen; nothing else breaks.
  }
}

contextBridge.exposeInMainWorld('__FREEAPI_DESKTOP__', true)
contextBridge.exposeInMainWorld('__FREEAPI_PLATFORM__', process.platform)
// The page asks for a fresh session when the old one runs out. It gets a session for the account it
// already runs as, and nothing else.
contextBridge.exposeInMainWorld('__FREEAPI_SESSION__', () => ipcRenderer.invoke('dashboard:session'))
const version = process.argv.find((a) => a.startsWith('--freeapi-version='))
if (version) contextBridge.exposeInMainWorld('__FREEAPI_VERSION__', version.slice('--freeapi-version='.length))
