import { Activity, Cpu, Github, PenLine, Settings as SettingsIcon, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react'
import { AUTHOR } from '@shared/defaults'
import { api } from '../api'
import { useApp, useL, type View } from '../store'
import { Mark } from './Mark'
import { cn } from './ui'

const ITEMS: { view: View; icon: LucideIcon; ru: string; en: string }[] = [
  { view: 'monitor', icon: Activity, ru: 'Монитор', en: 'Monitor' },
  { view: 'style', icon: PenLine, ru: 'Стиль', en: 'Style' },
  { view: 'behavior', icon: SlidersHorizontal, ru: 'Поведение', en: 'Behavior' },
  { view: 'account', icon: UserRound, ru: 'Аккаунт', en: 'Account' },
  { view: 'engine', icon: Cpu, ru: 'Нейросеть', en: 'Model' },
  { view: 'settings', icon: SettingsIcon, ru: 'Настройки', en: 'Settings' }
]

export function Sidebar() {
  const l = useL()
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const state = useApp((s) => s.status?.state ?? 'idle')
  const auth = useApp((s) => s.auth)
  const router = useApp((s) => s.router?.state)
  const working = state === 'running'
  // A dot beside a page that needs a look.
  const flag: Partial<Record<View, 'warn' | 'todo'>> = {
    ...(auth && !auth.signedIn ? { account: 'todo' as const } : {}),
    ...(router === 'failed' || router === 'missing' ? { engine: 'warn' as const } : {})
  }
  return (
    <nav className="flex w-[212px] shrink-0 flex-col border-r border-line bg-side" aria-label={l('Разделы', 'Sections')}>
      <div className="drag flex h-[52px] items-center gap-2.5 px-4">
        <Mark size={26} live={working} />
        <span className="display text-[1.3rem] font-semibold tracking-wide text-text">Brackets</span>
      </div>
      <ul className="no-drag flex flex-1 flex-col gap-0.5 px-2 pt-2">
        {ITEMS.map((it, i) => {
          const active = view === it.view
          const Icon = it.icon
          return (
            <li key={it.view} className={cn(i === 3 && 'mt-3 border-t border-line pt-3')}>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setView(it.view)}
                className={cn('flex h-9 w-full items-center gap-3 rounded-lg px-3 text-[0.93rem] transition-colors', active ? 'bg-petal-soft font-medium text-text' : 'text-text-2 hover:bg-sunken hover:text-text')}
              >
                <Icon size={17} className={active ? 'text-petal' : undefined} aria-hidden />
                <span className="flex-1 text-left">{l(it.ru, it.en)}</span>
                {flag[it.view] && <span className={cn('size-1.5 rounded-full', flag[it.view] === 'warn' ? 'bg-danger' : 'bg-pollen')} aria-hidden />}
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className="no-drag mx-2 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.8rem] text-text-3 transition-colors hover:bg-sunken hover:text-text"
        title={AUTHOR.github}
        onClick={() => void api.app.openExternal(AUTHOR.github)}
      >
        <Github size={14} aria-hidden />
        <span>
          {l('автор', 'by')} <span className="font-medium text-text-2">{AUTHOR.name}</span>
        </span>
      </button>
    </nav>
  )
}
