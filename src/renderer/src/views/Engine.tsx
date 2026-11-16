import { LayoutDashboard, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { LlmSample, RouterKey, RouterProvider } from '@shared/types'
import { api } from '../api'
import { Button, Chip, cn, ExternalLink, Field, inputCls, Page, PageHeader, Section, Segmented, Slider, Spinner, TextInput } from '../components/ui'
import { useApp, useL } from '../store'

// Providers with a generous free tier and a key that takes a minute to get.
const QUICK: { platform: string; name: string; url: string; ru: string; en: string }[] = [
  { platform: 'groq', name: 'Groq', url: 'https://console.groq.com/keys', ru: 'Очень быстрый. Хороший первый ключ.', en: 'Very fast. A good first key.' },
  { platform: 'google', name: 'Google AI Studio', url: 'https://aistudio.google.com/apikey', ru: 'Gemini. Хорошо пишет по-русски.', en: 'Gemini. Writes Russian well.' },
  { platform: 'cerebras', name: 'Cerebras', url: 'https://cloud.cerebras.ai/', ru: 'Тоже очень быстрый.', en: 'Also very fast.' },
  { platform: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/keys', ru: 'Много бесплатных моделей под одним ключом.', en: 'Many free models behind one key.' },
  { platform: 'mistral', name: 'Mistral', url: 'https://console.mistral.ai/', ru: 'Европейские модели.', en: 'European models.' }
]

function KeyRow({ info, provider, onAdded }: { info: (typeof QUICK)[number]; provider: RouterProvider | undefined; onAdded: () => void }) {
  const l = useL()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const add = async (): Promise<void> => {
    if (!key.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.router.addKey(info.platform, key.trim())
      setKey('')
      setMessage({ ok: true, text: r.notice || l(`Ключ добавлен, моделей: ${r.modelsAvailable}`, `Key added, models: ${r.modelsAvailable}`) })
      onAdded()
    } catch (err) {
      setMessage({ ok: false, text: String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="display text-[1.05rem] font-semibold text-text">{info.name}</span>
        {provider?.configured ? <Chip tone="ok">{l(`ключей: ${provider.keyCount}`, `keys: ${provider.keyCount}`)}</Chip> : <Chip>{l('ключа нет', 'no key')}</Chip>}
        <span className="text-[0.86rem] text-text-2">{l(info.ru, info.en)}</span>
        <span className="min-w-0 flex-1" />
        <span className="text-[0.86rem]">
          <ExternalLink href={info.url}>{l('Получить ключ', 'Get a key')}</ExternalLink>
        </span>
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input type="password" autoComplete="off" spellCheck={false} aria-label={l(`Ключ ${info.name}`, `${info.name} key`)} className={cn(inputCls, 'font-mono text-[0.86rem]')} value={key} placeholder={l('вставь ключ сюда', 'paste the key here')} onChange={(e) => setKey(e.target.value)} />
        <Button type="submit" disabled={busy || !key.trim()}>
          {busy ? <Spinner /> : <Plus size={15} aria-hidden />}
          {l('Добавить', 'Add')}
        </Button>
      </form>
      {message && <p className={cn('selectable mt-1.5 text-[0.84rem] leading-snug', message.ok ? 'text-ok' : 'text-danger')}>{message.text}</p>}
    </div>
  )
}

export function Engine() {
  const l = useL()
  const llm = useApp((s) => s.settings!.llm)
  const router = useApp((s) => s.router)
  const patch = useApp((s) => s.patch)
  const set = (v: Partial<typeof llm>): void => patch({ llm: v })
  const [providers, setProviders] = useState<RouterProvider[]>([])
  const [keys, setKeys] = useState<RouterKey[]>([])
  const [models, setModels] = useState<string[]>([])
  const [test, setTest] = useState<{ busy: boolean; result?: LlmSample }>({ busy: false })
  const [customKey, setCustomKey] = useState('')
  const [hasCustomKey, setHasCustomKey] = useState(false)
  const [logs, setLogs] = useState<string[] | null>(null)
  const ready = router?.state === 'ready'
  const builtin = llm.source === 'builtin'

  const refresh = useCallback(async (): Promise<void> => {
    if (builtin && !ready) return
    try {
      if (builtin) {
        const [p, k] = await Promise.all([api.router.providers(), api.router.keys()])
        setProviders(p)
        setKeys(k)
      }
      setModels(await api.router.models())
    } catch {
      /* the router is restarting; the next status change asks again */
    }
  }, [builtin, ready])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    void api.llm.hasCustomKey().then(setHasCustomKey)
  }, [])

  const runTest = async (): Promise<void> => {
    setTest({ busy: true })
    try {
      const [result] = await api.llm.sample(l('привет, как дела', 'hi, how is it going'), 1)
      setTest({ busy: false, result })
    } catch (err) {
      setTest({ busy: false, result: { ok: false, text: '', raw: '', via: '', ms: 0, error: String((err as Error)?.message ?? err) } })
    }
  }

  const state = router?.state ?? 'stopped'
  const stateChip =
    state === 'ready' ? <Chip tone="ok">{l('работает', 'running')}</Chip> : state === 'starting' ? <Chip tone="pollen">{l('запускается', 'starting')}</Chip> : state === 'stopped' ? <Chip>{l('остановлена', 'stopped')}</Chip> : <Chip tone="danger">{state === 'missing' ? l('не собрана', 'not built') : l('не запустилась', 'failed')}</Chip>
  const keyless = providers.filter((p) => p.keyless && p.kind === 'chat' && p.configured)
  const withKeys = providers.filter((p) => p.configured && !p.keyless)
  const named = new Map(providers.map((p) => [p.platform, p.name]))

  return (
    <Page>
      <PageHeader title={l('Нейросеть', 'Model')} description={l('Кто пишет ответы. По умолчанию это встроенный FreeLLMAPI: он собирает бесплатные тарифы десятков сервисов в одну точку и сам переключается между ними.', 'What writes the replies. By default it is the built-in FreeLLMAPI: it gathers the free tiers of dozens of services behind one address and switches between them by itself.')} />

      <Section title={l('Откуда брать ответы', 'Where replies come from')}>
        <Segmented
          label={l('Откуда брать ответы', 'Where replies come from')}
          value={llm.source}
          options={[
            { value: 'builtin', label: l('Встроенный FreeLLMAPI', 'Built-in FreeLLMAPI') },
            { value: 'custom', label: l('Свой сервер', 'My own server') }
          ]}
          onChange={(source) => set({ source })}
        />
      </Section>

      {builtin ? (
        <>
          <Section
            title="FreeLLMAPI"
            aside={
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="ghost" onClick={() => void api.router.restart()}>
                  <RefreshCw size={14} aria-hidden />
                  {l('Перезапустить', 'Restart')}
                </Button>
                <Button size="sm" variant="primary" disabled={!ready} onClick={() => void api.router.openDashboard()}>
                  <LayoutDashboard size={14} aria-hidden />
                  {l('Открыть панель', 'Open the dashboard')}
                </Button>
              </div>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              {stateChip}
              {router?.version && <Chip>{l(`версия ${router.version}`, `version ${router.version}`)}</Chip>}
              {ready && <Chip>{l(`порт ${router.port}, только этот компьютер`, `port ${router.port}, this computer only`)}</Chip>}
              {ready && <Chip tone={withKeys.length ? 'petal' : 'plain'}>{l(`сервисов с ключом: ${withKeys.length}`, `services with a key: ${withKeys.length}`)}</Chip>}
              {ready && keyless.length > 0 && <Chip>{l(`без ключа: ${keyless.map((p) => p.name).join(', ')}`, `no key needed: ${keyless.map((p) => p.name).join(', ')}`)}</Chip>}
            </div>
            {router?.error && <p className="selectable mt-2 text-[0.86rem] leading-snug text-danger">{router.error}</p>}
            <p className="mt-3 max-w-[62ch] text-[0.88rem] leading-relaxed text-text-2">
              {l('В панели FreeLLMAPI есть всё остальное: все сервисы, порядок переключения между ними, статистика и журнал запросов. Это отдельный проект с открытым кодом: ', 'The FreeLLMAPI dashboard has the rest: every service, the order it falls back in, statistics and the request log. It is a separate open-source project: ')}
              <ExternalLink href="https://github.com/tashfeenahmed/freellmapi">github.com/tashfeenahmed/freellmapi</ExternalLink>
            </p>
          </Section>

          <Section title={l('Ключи', 'Keys')} description={l('Brackets отвечает и без единого ключа, через сервисы, которым он не нужен, но их лимит невелик и они медленнее. Один бесплатный ключ из списка делает ответы быстрее и надёжнее. Ключи хранятся на этом компьютере в зашифрованном виде.', 'Brackets answers without a single key, through services that need none, but their limit is small and they are slower. One free key from this list makes replies faster and more dependable. Keys are kept on this computer, encrypted.')}>
            {!ready ? (
              <p className="text-[0.88rem] text-text-3">{l('Список появится, когда нейросеть запустится.', 'The list appears once the router is running.')}</p>
            ) : (
              <>
                {QUICK.filter((q) => providers.some((p) => p.platform === q.platform)).map((q) => (
                  <KeyRow key={q.platform} info={q} provider={providers.find((p) => p.platform === q.platform)} onAdded={() => void refresh()} />
                ))}
                {keys.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <div className="text-[0.84rem] text-text-2">{l('Добавленные ключи', 'Keys added')}</div>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {keys.map((k) => (
                        <li key={k.id} className="flex items-center gap-2.5 rounded-md px-2 py-1 text-[0.88rem] hover:bg-sunken">
                          <span className="w-36 truncate text-text">{named.get(k.platform) ?? k.platform}</span>
                          <span className="selectable truncate font-mono text-[0.8rem] text-text-3">{k.maskedKey}</span>
                          <span className="min-w-0 flex-1" />
                          <Chip tone={k.status === 'healthy' || k.status === 'valid' ? 'ok' : k.status === 'unknown' ? 'plain' : 'pollen'}>{k.status}</Chip>
                          <button type="button" aria-label={l('Удалить ключ', 'Remove the key')} title={l('Удалить ключ', 'Remove the key')} className="rounded p-1 text-text-3 hover:bg-danger-soft hover:text-danger" onClick={() => void api.router.removeKey(k.id).then(refresh)}>
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Section>

          <Section title={l('Какая модель', 'Which model')}>
            <Field label={l('Выбор модели', 'Model choice')} hint={l('«auto» отдаёт выбор FreeLLMAPI: он берёт лучшую из доступных и переходит к следующей, если эта занята. Можно вписать и конкретную модель.', '"auto" leaves the choice to FreeLLMAPI: it takes the best one available and moves to the next when that one is busy. You can also type a specific model.')}>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  label={l('Выбор модели', 'Model choice')}
                  value={['auto', 'auto:fast', 'auto:smart'].includes(llm.model) ? (llm.model as 'auto') : ('other' as 'auto')}
                  options={[
                    { value: 'auto', label: l('Сама', 'Auto') },
                    { value: 'auto:fast' as 'auto', label: l('Быстрее', 'Faster') },
                    { value: 'auto:smart' as 'auto', label: l('Умнее', 'Smarter') }
                  ]}
                  onChange={(model) => set({ model })}
                />
                <div className="min-w-56 flex-1">
                  <TextInput mono ariaLabel={l('Название модели', 'Model name')} value={llm.model} onCommit={(model) => set({ model: model.trim() || 'auto' })} placeholder="auto" />
                </div>
              </div>
              {models.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[0.84rem] text-text-2 hover:text-text">{l(`Доступные модели: ${models.length}`, `Models available: ${models.length}`)}</summary>
                  <div className="mt-1.5 flex max-h-44 flex-wrap gap-1 overflow-y-auto">
                    {models.map((m) => (
                      <button key={m} type="button" className={cn('rounded px-1.5 py-0.5 font-mono text-[0.76rem]', m === llm.model ? 'bg-petal-soft text-petal' : 'bg-sunken text-text-2 hover:text-text')} onClick={() => set({ model: m })}>
                        {m}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </Field>
          </Section>
        </>
      ) : (
        <Section title={l('Свой сервер', 'My own server')} description={l('Любой сервер с OpenAI-совместимым API: Ollama, LM Studio, llama.cpp или платный сервис.', 'Any server with an OpenAI-compatible API: Ollama, LM Studio, llama.cpp or a paid service.')}>
          <Field label={l('Адрес', 'Address')} hint={l('Заканчивается на /v1.', 'Ends with /v1.')}>
            <TextInput mono ariaLabel={l('Адрес', 'Address')} value={llm.customBaseUrl} onCommit={(customBaseUrl) => set({ customBaseUrl })} placeholder="http://127.0.0.1:11434/v1" />
          </Field>
          <Field label={l('Модель', 'Model')}>
            <TextInput mono ariaLabel={l('Модель', 'Model')} value={llm.customModel} onCommit={(customModel) => set({ customModel })} placeholder="qwen3:8b" />
            {models.length > 0 && (
              <div className="mt-1.5 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                {models.map((m) => (
                  <button key={m} type="button" className={cn('rounded px-1.5 py-0.5 font-mono text-[0.76rem]', m === llm.customModel ? 'bg-petal-soft text-petal' : 'bg-sunken text-text-2 hover:text-text')} onClick={() => set({ customModel: m })}>
                    {m}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field label={l('Ключ', 'Key')} hint={hasCustomKey ? l('Ключ сохранён. Чтобы заменить, вставь новый.', 'A key is saved. Paste a new one to replace it.') : l('Локальным серверам ключ обычно не нужен.', 'Local servers usually need no key.')}>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void api.llm.setCustomKey(customKey).then(() => {
                  setHasCustomKey(Boolean(customKey.trim()))
                  setCustomKey('')
                  void refresh()
                })
              }}
            >
              <input type="password" autoComplete="off" spellCheck={false} aria-label={l('Ключ', 'Key')} className={cn(inputCls, 'font-mono text-[0.86rem]')} value={customKey} onChange={(e) => setCustomKey(e.target.value)} />
              <Button type="submit" disabled={!customKey.trim() && !hasCustomKey}>
                {customKey.trim() ? l('Сохранить', 'Save') : l('Удалить ключ', 'Remove the key')}
              </Button>
            </form>
          </Field>
        </Section>
      )}

      <Section title={l('Как писать', 'How it writes')}>
        <Slider label={l('Вольность', 'Freedom')} hint={l('Ниже: ровнее и предсказуемее. Выше: живее, но чаще несёт чушь.', 'Lower: steadier and more predictable. Higher: livelier, but more nonsense.')} value={llm.temperature} min={0} max={1.6} step={0.05} onChange={(temperature) => set({ temperature })} format={(v) => v.toFixed(2).replace('.', l(',', '.'))} />
        <Slider label={l('Ждать ответа модели не дольше', 'Wait for the model no longer than')} value={llm.timeoutSec} min={5} max={90} step={5} onChange={(timeoutSec) => set({ timeoutSec })} format={(v) => l(`${v} с`, `${v} s`)} />
        <Slider label={l('Запас на ответ', 'Room for the answer')} hint={l('Сколько токенов модель может потратить. Думающим моделям нужно больше, иначе ответ выходит пустым.', 'How many tokens the model may spend. Models that think first need more, or the answer comes out empty.')} value={llm.maxTokens} min={60} max={1500} step={20} onChange={(maxTokens) => set({ maxTokens })} />
      </Section>

      <Section title={l('Проверка', 'Check')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={test.busy} onClick={() => void runTest()}>
            {test.busy ? <Spinner /> : <Zap size={15} aria-hidden />}
            {l('Попросить один ответ', 'Ask for one reply')}
          </Button>
          {test.result &&
            (test.result.ok ? (
              <span className="selectable text-[0.92rem] text-text">
                <span className="font-medium">{test.result.text}</span>
                <span className="num ml-2.5 text-[0.84rem] text-text-3">
                  {test.result.via} {(test.result.ms / 1000).toFixed(1)} {l('с', 's')}
                </span>
              </span>
            ) : (
              <span className="selectable max-w-[60ch] text-[0.86rem] leading-snug text-danger">{test.result.error}</span>
            ))}
        </div>
        {builtin && (
          <details
            className="mt-4"
            onToggle={(e) => {
              if (e.currentTarget.open) void api.router.logs().then(setLogs)
            }}
          >
            <summary className="text-[0.88rem] text-text-2 hover:text-text">{l('Журнал FreeLLMAPI', 'The FreeLLMAPI log')}</summary>
            <pre className="selectable mt-2 max-h-72 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[0.74rem] leading-relaxed whitespace-pre-wrap text-text-2">{logs?.length ? logs.join('\n') : l('Пока пусто.', 'Nothing yet.')}</pre>
          </details>
        )}
      </Section>
    </Page>
  )
}
