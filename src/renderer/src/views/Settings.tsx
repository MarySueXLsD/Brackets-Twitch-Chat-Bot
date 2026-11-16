import { Check, FolderOpen } from 'lucide-react'
import { AUTHOR } from '@shared/defaults'
import { BRAND_PREVIEW, THEMES, type ThemeDef } from '@shared/themes'
import { api } from '../api'
import { Button, cn, ExternalLink, Field, Page, PageHeader, Section, Segmented, Switch } from '../components/ui'
import { useApp, useL } from '../store'

/** A theme shown as a tiny copy of the window: sidebar, a few chat lines, a reply, the playhead. */
function ThemeCard({ theme, active, dark, name, onPick }: { theme: ThemeDef; active: boolean; dark: boolean; name: string; onPick: () => void }) {
  const built = BRAND_PREVIEW[dark ? 'dark' : 'light']
  const t = theme.tokens
  const c = t ? { paper: t.paper, side: t.side, raised: t.raised, text: t.text, text3: t.text3, petal: t.petal, pollen: t.pollen } : built
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onPick} className={cn('group overflow-hidden rounded-xl border text-left transition-colors', active ? 'border-petal' : 'border-line hover:border-line-strong')}>
      <span className="flex h-[76px]" style={{ background: c.paper }} aria-hidden>
        <span className="flex w-[26%] flex-col gap-1 p-1.5" style={{ background: c.side }}>
          <span className="h-1.5 w-3/4 rounded-full" style={{ background: c.petal }} />
          <span className="h-1 w-full rounded-full opacity-40" style={{ background: c.text3 }} />
          <span className="h-1 w-2/3 rounded-full opacity-40" style={{ background: c.text3 }} />
        </span>
        <span className="relative flex flex-1 flex-col gap-1 p-2">
          <span className="h-1 w-3/4 rounded-full opacity-70" style={{ background: c.text3 }} />
          <span className="h-1 w-1/2 rounded-full opacity-70" style={{ background: c.text3 }} />
          <span className="h-3 w-2/3 rounded border-l-2" style={{ background: c.raised, borderColor: c.petal }} />
          <span className="h-1 w-3/5 rounded-full opacity-70" style={{ background: c.text3 }} />
          <span className="absolute inset-y-1.5 right-4 w-px" style={{ background: c.pollen }} />
        </span>
      </span>
      <span className={cn('flex items-center justify-between border-t px-2.5 py-1.5 text-[0.86rem]', active ? 'border-petal bg-petal-soft text-text' : 'border-line bg-surface text-text-2 group-hover:text-text')}>
        {name}
        {active && <Check size={14} className="text-petal" aria-hidden />}
      </span>
    </button>
  )
}

export function SettingsView() {
  const l = useL()
  const ui = useApp((s) => s.settings!.ui)
  const info = useApp((s) => s.info)
  const patch = useApp((s) => s.patch)
  const set = (v: Partial<typeof ui>): void => patch({ ui: v })
  const dark = document.documentElement.dataset.theme !== 'light'

  return (
    <Page>
      <PageHeader title={l('Настройки', 'Settings')} />

      <Section title={l('Оформление', 'Appearance')}>
        <div className="grid grid-cols-4 gap-2.5" role="radiogroup" aria-label={l('Тема', 'Theme')}>
          {THEMES.map((t) => (
            <ThemeCard key={t.id} theme={t} active={ui.theme === t.id} dark={dark} name={l(t.ru, t.en)} onPick={() => set({ theme: t.id })} />
          ))}
        </div>
        {ui.theme === 'brackets' && (
          <Field label={l('Светлая или тёмная', 'Light or dark')}>
            <Segmented
              label={l('Светлая или тёмная', 'Light or dark')}
              value={ui.scheme}
              options={[
                { value: 'dark', label: l('Тёмная', 'Dark') },
                { value: 'light', label: l('Светлая', 'Light') },
                { value: 'system', label: l('Как в Windows', 'Same as Windows') }
              ]}
              onChange={(scheme) => set({ scheme })}
            />
          </Field>
        )}
        <Field label={l('Язык', 'Language')}>
          <Segmented
            label={l('Язык', 'Language')}
            value={ui.lang}
            options={[
              { value: 'auto', label: l('Как в Windows', 'Same as Windows') },
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English' }
            ]}
            onChange={(lang) => set({ lang })}
          />
        </Field>
      </Section>

      <Section title={l('Окно и запуск', 'Window and startup')}>
        <Switch checked={ui.closeToTray} onChange={(closeToTray) => set({ closeToTray })} label={l('Крестик сворачивает в трей', 'The close button hides to the tray')} description={l('Brackets продолжает отвечать в чате. Выйти совсем можно через значок в трее.', 'Brackets keeps answering in chat. To quit for good, use the tray icon.')} />
        <Switch checked={ui.autoStart} onChange={(autoStart) => set({ autoStart })} label={l('Начинать отвечать сразу при открытии', 'Start answering as soon as the app opens')} />
        <Switch checked={ui.launchAtLogin} disabled={!info?.packaged} onChange={(launchAtLogin) => set({ launchAtLogin })} label={l('Запускать вместе с Windows', 'Start with Windows')} description={info?.packaged ? undefined : l('Работает в установленной версии, не при запуске из исходников.', 'Works in the installed version, not when run from source.')} />
        <Switch checked={ui.startHidden} onChange={(startHidden) => set({ startHidden })} label={l('Запускаться свёрнутым в трей', 'Start hidden in the tray')} />
      </Section>

      <Section title={l('Данные', 'Data')} description={l('Настройки, вход в Twitch и база FreeLLMAPI с ключами лежат в одной папке на этом компьютере. Токены и ключи в ней зашифрованы.', 'The settings, the Twitch sign-in and the FreeLLMAPI database with its keys live in one folder on this computer. The tokens and keys in it are encrypted.')}>
        <div className="flex items-center gap-3">
          <code className="selectable min-w-0 flex-1 truncate rounded-lg bg-sunken px-3 py-2 font-mono text-[0.8rem] text-text-2">{info?.dataDir}</code>
          <Button variant="outline" onClick={() => void api.app.openDataDir()}>
            <FolderOpen size={15} aria-hidden />
            {l('Открыть папку', 'Open the folder')}
          </Button>
        </div>
      </Section>

      <Section title={l('О программе', 'About')}>
        <p className="text-[0.95rem] text-text">
          {l('Автор: ', 'Made by ')}
          <span className="font-semibold">{AUTHOR.name}</span>
          <span className="ml-3 text-[0.9rem]">
            <ExternalLink href={AUTHOR.github}>GitHub</ExternalLink>
          </span>
          <span className="ml-3 text-[0.9rem]">
            <ExternalLink href={AUTHOR.itch}>itch.io</ExternalLink>
          </span>
        </p>
        <p className="num mt-2 text-[0.95rem] text-text-2">
          Brackets {info?.version}, FreeLLMAPI {info?.routerVersion || '—'}, Electron {info?.electron}
        </p>
        <p className="mt-2 max-w-[62ch] text-[0.88rem] leading-relaxed text-text-2">
          {l('Ответы пишет нейросеть через ', 'The replies are written by a model through ')}
          <ExternalLink href="https://github.com/tashfeenahmed/freellmapi">FreeLLMAPI</ExternalLink>
          {l(' (автор Tashfeen Ahmed, лицензия MIT), который встроен в программу целиком. Сообщения чата, на которые пишется ответ, уходят тому сервису, который отвечает; больше никуда.', ' (by Tashfeen Ahmed, MIT licence), which is built into the app whole. The chat messages a reply is written for go to the service that answers, and nowhere else.')}
        </p>
        <p className="mt-2 max-w-[62ch] text-[0.88rem] leading-relaxed text-text-2">{l('Автоматические ответы от своего имени разрешены не в каждом чате. Если стример или модераторы против, не включай его там.', 'Automatic replies in your name are not welcome in every chat. If the streamer or the moderators object, do not run it there.')}</p>
      </Section>
    </Page>
  )
}
