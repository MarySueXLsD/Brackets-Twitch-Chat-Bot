import { Cpu, FlaskConical, MessagesSquare, Radio, Timer, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp, useL } from '../store'
import { cn } from './ui'

function Seg({ icon: Icon, children, title, tone, onClick }: { icon?: LucideIcon; children: ReactNode; title: string; tone?: 'warn' | 'live' | 'ok'; onClick?: () => void }) {
  const cls = cn('num inline-flex h-full items-center gap-1.5 px-3 text-[0.82rem] tracking-wide whitespace-nowrap', tone === 'warn' ? 'text-danger' : tone === 'live' ? 'text-pollen' : tone === 'ok' ? 'text-text' : 'text-text-2', onClick && 'hover:bg-sunken')
  const body = (
    <>
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </>
  )
  return onClick ? (
    <button type="button" className={cls} title={title} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={cls} title={title}>
      {body}
    </span>
  )
}

/** The strip along the bottom: what is connected, how fast it runs, which model answered last. */
export function StatusBar() {
  const l = useL()
  const s = useApp((st) => st.status)
  const router = useApp((st) => st.router)
  const source = useApp((st) => st.settings?.llm.source ?? 'builtin')
  const version = useApp((st) => st.info?.version ?? '')
  const setView = useApp((st) => st.setView)
  if (!s) return <footer className="h-7 shrink-0 border-t border-line bg-side" />

  const twitch = {
    offline: { text: l('Чат: не подключён', 'Chat: not connected'), tone: undefined },
    connecting: { text: l('Чат: подключаюсь…', 'Chat: connecting…'), tone: 'live' as const },
    reconnecting: { text: l('Чат: переподключаюсь…', 'Chat: reconnecting…'), tone: 'live' as const },
    connected: { text: s.anonymous ? l(`Чат: ${s.channel}, гость`, `Chat: ${s.channel}, guest`) : l(`Чат: ${s.channel}, ${s.login}`, `Chat: ${s.channel}, ${s.login}`), tone: 'ok' as const },
    auth_failed: { text: l('Чат: вход не принят', 'Chat: sign-in refused'), tone: 'warn' as const }
  }[s.twitch]

  const engine =
    source === 'custom'
      ? { text: l('Свой сервер модели', 'Your own model server'), tone: undefined }
      : {
          stopped: { text: l('Нейросеть остановлена', 'Model router stopped'), tone: undefined },
          starting: { text: l('Нейросеть запускается…', 'Model router starting…'), tone: 'live' as const },
          ready: { text: `FreeLLMAPI ${router?.version ?? ''}`.trim(), tone: 'ok' as const },
          failed: { text: l('Нейросеть не запустилась', 'Model router failed'), tone: 'warn' as const },
          missing: { text: l('Нейросеть не собрана', 'Model router not built'), tone: 'warn' as const }
        }[router?.state ?? 'stopped']

  return (
    <footer className="flex h-7 shrink-0 items-stretch divide-x divide-line overflow-hidden border-t border-line bg-side" aria-label={l('Состояние', 'Status')}>
      <Seg icon={Radio} title={l('Соединение с чатом Twitch', 'The connection to Twitch chat')} tone={twitch.tone} onClick={() => setView('account')}>
        {twitch.text}
      </Seg>
      {s.state === 'running' && (
        <Seg icon={MessagesSquare} title={l('Сообщений в чате за последнюю минуту', 'Chat messages in the last minute')}>
          {s.perMin} {l('в мин', 'per min')}
        </Seg>
      )}
      {s.stream.known && s.state === 'running' && (
        <Seg title={s.stream.title || l('Стрим', 'Stream')} tone={s.stream.live ? 'ok' : undefined}>
          <span className={cn('size-1.5 rounded-full', s.stream.live ? 'bg-danger' : 'bg-text-3')} aria-hidden />
          {s.stream.live ? l(`в эфире, ${s.stream.viewers} зрит.`, `live, ${s.stream.viewers} viewers`) : l('не в эфире', 'offline')}
        </Seg>
      )}
      <span className="min-w-0 flex-1" />
      {s.test && s.state === 'running' && (
        <Seg icon={FlaskConical} tone="live" title={l('Ответы пишутся, но не отправляются в чат', 'Replies are written but not sent to chat')} onClick={() => setView(s.anonymous ? 'account' : 'behavior')}>
          {l('тестовый режим', 'test mode')}
        </Seg>
      )}
      {s.llm.lastVia && (
        <Seg icon={Timer} title={l('Кто написал последний ответ и за сколько', 'What wrote the last reply, and how fast')}>
          <span className="max-w-64 truncate">{s.llm.lastVia}</span>
          {(s.llm.lastMs / 1000).toFixed(1)} {l('с', 's')}
        </Seg>
      )}
      <Seg icon={Cpu} title={l('Нейросеть, которая пишет ответы', 'The model that writes the replies')} tone={engine.tone} onClick={() => setView('engine')}>
        {engine.text}
      </Seg>
      <Seg title="Brackets">{version}</Seg>
    </footer>
  )
}
