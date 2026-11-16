import { ExternalLink as ExternalIcon, LogOut, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { BUILTIN_TWITCH_CLIENT_ID } from '@shared/defaults'
import { api } from '../api'
import { Button, Chip, ExternalLink, Field, inputCls, Page, PageHeader, Section, Spinner, TextInput } from '../components/ui'
import { useApp, useL } from '../store'

type L = (ru: string, en: string) => string

const ERRORS: Record<string, [string, string]> = {
  no_client_id: ['Сначала вставь Client ID ниже.', 'Paste a Client ID below first.'],
  bad_client_id: ['Twitch не знает такой Client ID. Проверь, что он скопирован целиком и что тип приложения Public.', 'Twitch does not know this Client ID. Check that it was copied whole and that the application type is Public.'],
  network: ['Не получилось связаться с Twitch. Проверь интернет и попробуй ещё раз.', 'Twitch could not be reached. Check the connection and try again.'],
  denied: ['Вход отклонён на странице Twitch.', 'The sign-in was declined on the Twitch page.'],
  code_expired: ['Код устарел. Нажми «Войти через Twitch», чтобы получить новый.', 'The code ran out. Press "Sign in with Twitch" for a new one.'],
  bad_token: ['Twitch не принял этот токен.', 'Twitch did not accept this token.'],
  expired: ['Вход устарел и не продлился сам. Войди заново.', 'The sign-in ran out and could not renew itself. Sign in again.']
}

function when(ts: number, l: L): string {
  if (!ts) return l('неизвестно', 'unknown')
  const left = ts - Date.now()
  if (left <= 0) return l('уже истёк', 'already ran out')
  const hours = left / 3600000
  if (hours < 1) return l(`ещё ${Math.max(1, Math.round(left / 60000))} мин`, `${Math.max(1, Math.round(left / 60000))} min left`)
  if (hours < 48) return l(`ещё ${Math.round(hours)} ч`, `${Math.round(hours)} h left`)
  return l(`ещё ${Math.round(hours / 24)} дн.`, `${Math.round(hours / 24)} days left`)
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((until - now) / 1000))
  return (
    <span className="num">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  )
}

/** The less common ways in. Folded away when the app came with a Client ID of its own. */
function Advanced({ folded, label, children }: { folded: boolean; label: string; children: ReactNode }) {
  if (!folded) return <>{children}</>
  return (
    <details className="mt-6 border-t border-line pt-4">
      <summary className="text-[0.9rem] text-text-2 hover:text-text">{label}</summary>
      <div className="mt-5">{children}</div>
    </details>
  )
}

export function Account() {
  const l = useL()
  const auth = useApp((s) => s.auth)
  const clientId = useApp((s) => s.settings!.twitch.clientId)
  const patch = useApp((s) => s.patch)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  if (!auth) return null
  const error = auth.error ? ERRORS[auth.error] : undefined
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title={l('Аккаунт', 'Account')} description={l('Brackets пишет в чат от имени твоего аккаунта Twitch. Пароль ему не нужен: он его не видит и никогда не спросит.', 'Brackets writes to chat as your Twitch account. It needs no password: it never sees one and will never ask.')} />

      {auth.signedIn ? (
        <Section title={l(`Вошёл как ${auth.login}`, `Signed in as ${auth.login}`)}>
          <div className="flex flex-wrap items-center gap-2">
            {auth.canChat ? <Chip tone="ok">{l('может писать в чат', 'may write to chat')}</Chip> : <Chip tone="danger">{l('не может писать в чат', 'may not write to chat')}</Chip>}
            {auth.renews ? <Chip tone="petal">{l('вход продлевается сам', 'the sign-in renews itself')}</Chip> : <Chip tone="pollen">{l(`вход действует ${when(auth.expiresAt, l)}`, `the sign-in has ${when(auth.expiresAt, l)}`)}</Chip>}
          </div>
          {!auth.canChat && <p className="mt-3 max-w-[60ch] text-[0.88rem] leading-relaxed text-text-2">{l('У этого токена нет права chat:edit, поэтому ответы пишутся, но не отправляются. Выйди и войди через Twitch заново.', 'This token lacks the chat:edit permission, so replies are written but not sent. Sign out and sign in with Twitch again.')}</p>}
          {!auth.renews && auth.canChat && <p className="mt-3 max-w-[60ch] text-[0.88rem] leading-relaxed text-text-2">{l('Токен был вставлен вручную, поэтому продлить его сам Brackets не может. Когда он истечёт, понадобится новый.', 'The token was pasted by hand, so Brackets cannot renew it. When it runs out you will need a new one.')}</p>}
          <div className="mt-4">
            <Button variant="outline" disabled={busy} onClick={() => void act(() => api.auth.signOut())}>
              <LogOut size={15} aria-hidden />
              {l('Выйти', 'Sign out')}
            </Button>
          </div>
        </Section>
      ) : auth.device ? (
        <Section title={l('Введи код на сайте Twitch', 'Enter the code on the Twitch site')} description={l('Страница twitch.tv/activate уже открылась в браузере. Войди там в свой аккаунт, если попросит, и подтверди код.', 'The page twitch.tv/activate has opened in your browser. Sign in to your account there if asked, and confirm the code.')}>
          <div className="selectable display mt-1 inline-block rounded-xl border border-line bg-surface px-6 py-3 text-[2.8rem] leading-none font-semibold tracking-[0.18em] text-text">{auth.device.userCode}</div>
          <div className="mt-3 flex items-center gap-2 text-[0.9rem] text-text-2">
            <Spinner />
            <span>
              {l('Жду подтверждения. Код действует ещё ', 'Waiting for the confirmation. The code is good for another ')}
              <Countdown until={auth.device.expiresAt} />
            </span>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => void api.app.openExternal(auth.device!.url)}>
              <ExternalIcon size={15} aria-hidden />
              {l('Открыть страницу ещё раз', 'Open the page again')}
            </Button>
            <Button variant="ghost" onClick={() => void api.auth.cancelDevice()}>
              {l('Отмена', 'Cancel')}
            </Button>
          </div>
        </Section>
      ) : (
        <Section title={l('Вход не выполнен', 'Not signed in')} description={l('Пока можно только смотреть: Brackets читает любой чат как гость и показывает, что бы он ответил, но ничего не отправляет.', 'For now you can only watch: Brackets reads any chat as a guest and shows what it would answer, but sends nothing.')}>
          <Button variant="primary" disabled={busy || !clientId} onClick={() => void act(() => api.auth.startDevice())}>
            {busy ? <Spinner className="text-on-petal" /> : <ShieldCheck size={16} aria-hidden />}
            {l('Войти через Twitch', 'Sign in with Twitch')}
          </Button>
          {!clientId && <p className="mt-2 text-[0.86rem] text-text-2">{l('Для входа нужен Client ID. Как его получить, написано ниже; это делается один раз.', 'Signing in needs a Client ID. How to get one is described below; it is done once.')}</p>}
        </Section>
      )}

      {error && <p className="mt-1 rounded-lg bg-danger-soft px-3 py-2 text-[0.9rem] text-danger">{l(...error)}</p>}

      {!auth.signedIn && !auth.device && (
        <Advanced folded={Boolean(BUILTIN_TWITCH_CLIENT_ID) && clientId === BUILTIN_TWITCH_CLIENT_ID} label={l('Свой Client ID или готовый токен', 'Your own Client ID, or a ready token')}>
          <Section title="Client ID" description={l('Номер твоего приложения на Twitch. Он не секретный, но вход без него не работает.', 'The number of your application on Twitch. It is not a secret, but signing in does not work without it.')}>
            <TextInput mono ariaLabel="Client ID" value={clientId} onCommit={(v) => patch({ twitch: { clientId: v.trim() } })} placeholder="abcdefghijklmnopqrstuvwxyz0123" />
            <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[0.88rem] leading-relaxed text-text-2">
              <li>
                {l('Открой ', 'Open ')}
                <ExternalLink href="https://dev.twitch.tv/console/apps">dev.twitch.tv/console/apps</ExternalLink>
                {l(' и нажми «Подать заявку на регистрацию приложения» (Register Your Application). Twitch попросит включить двухфакторную защиту, если она ещё выключена.', ' and press Register Your Application. Twitch asks you to turn on two-factor protection if it is still off.')}
              </li>
              <li>
                {l(
                  'Название: любое, без слова Twitch. OAuth Redirect URL: http://localhost и кнопка «Добавить» (подсказка про HTTPS к localhost не относится). Категория: Chat Bot. Тип клиента: «виден всем» (Public), не «Конфиденциально».',
                  'Name: anything without the word Twitch. OAuth Redirect URLs: http://localhost, then Add (the note about HTTPS does not apply to localhost). Category: Chat Bot. Client Type: Public, not Confidential.'
                )}
              </li>
              <li>{l('Нажми «Создать», потом «Управление» рядом с приложением и скопируй «Идентификатор клиента» сюда. Секрет не нужен.', 'Press Create, then Manage next to the application, and copy the Client ID here. No secret is needed.')}</li>
            </ol>
          </Section>

          <Section title={l('Или вставь готовый токен', 'Or paste a ready token')} description={l('Если у тебя уже есть токен доступа с правами chat:read и chat:edit. Он хранится на этом компьютере в зашифрованном виде.', 'If you already have an access token with the chat:read and chat:edit permissions. It is kept on this computer, encrypted.')}>
            <Field label={l('Токен доступа', 'Access token')}>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (token.trim()) void act(() => api.auth.setToken(token)).then(() => setToken(''))
                }}
              >
                <input type="password" autoComplete="off" spellCheck={false} aria-label={l('Токен доступа', 'Access token')} className={`${inputCls} font-mono text-[0.88rem]`} value={token} onChange={(e) => setToken(e.target.value)} />
                <Button type="submit" disabled={busy || !token.trim()}>
                  {l('Войти по токену', 'Sign in with the token')}
                </Button>
              </form>
            </Field>
          </Section>
        </Advanced>
      )}
    </Page>
  )
}
