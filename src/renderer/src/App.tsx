import { useEffect } from 'react'
import { cssVars, BRAND_PREVIEW, themeTokens } from '@shared/themes'
import { api } from './api'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { useApp, useLang } from './store'
import { Account } from './views/Account'
import { Behavior } from './views/Behavior'
import { Engine } from './views/Engine'
import { Monitor } from './views/Monitor'
import { SettingsView } from './views/Settings'
import { Style } from './views/Style'

/** Put the chosen theme on the page and colour the window buttons to match. */
function useTheme(): void {
  const theme = useApp((s) => s.settings?.ui.theme ?? 'brackets')
  const scheme = useApp((s) => s.settings?.ui.scheme ?? 'dark')
  useEffect(() => {
    const root = document.documentElement
    const tokens = themeTokens(theme)
    const apply = (): void => {
      const dark = tokens ? tokens.scheme === 'dark' : scheme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : scheme === 'dark'
      root.dataset.theme = dark ? 'dark' : 'light'
      // Variables set by a previous theme must go before the next one is laid on.
      root.removeAttribute('style')
      if (tokens) for (const [name, value] of Object.entries(cssVars(tokens))) root.style.setProperty(name, value)
      if (tokens?.glow) root.dataset.glow = ''
      else delete root.dataset.glow
      const preview = BRAND_PREVIEW[dark ? 'dark' : 'light']
      void api.app.chrome({ color: tokens ? tokens.paper : preview.paper, symbolColor: tokens ? tokens.text2 : dark ? '#a9a5c0' : '#5c5873' })
    }
    apply()
    if (tokens || scheme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, scheme])
}

export function App() {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const init = useApp((s) => s.init)
  const lang = useLang()
  useTheme()
  useEffect(() => {
    void init()
  }, [init])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  if (!ready) return <div className="drag h-full bg-paper" />
  return (
    <div className="flex h-full flex-col bg-paper text-text">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {/* The monitor's own top bar is the window's title bar; the other pages get a plain strip to drag by. */}
          {view !== 'monitor' && <div className="drag h-10 shrink-0" />}
          <div className="min-h-0 flex-1">
            {view === 'monitor' && <Monitor />}
            {view === 'style' && <Style />}
            {view === 'behavior' && <Behavior />}
            {view === 'account' && <Account />}
            {view === 'engine' && <Engine />}
            {view === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
