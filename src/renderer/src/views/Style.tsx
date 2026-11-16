import { RotateCcw, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import type { LlmSample } from '@shared/types'
import { api } from '../api'
import { Button, cn, Field, inputCls, Page, PageHeader, Section, Segmented, Slider, Spinner, Switch, TagInput, TextArea } from '../components/ui'
import { useApp, useL } from '../store'

/** Try the manner out: a made-up chat message in, a few replies out. Nothing goes to Twitch. */
function TryIt() {
  const l = useL()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [samples, setSamples] = useState<LlmSample[] | null>(null)
  const [prompt, setPrompt] = useState<{ system: string; user: string } | null>(null)
  const placeholder = l('ну и как вам стрим сегодня', 'so how do you like the stream today')

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      setSamples(await api.llm.sample(message, 3))
    } catch (err) {
      setSamples([{ ok: false, text: '', raw: '', via: '', ms: 0, error: String((err as Error)?.message ?? err) }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="sticky top-0 w-[380px] shrink-0 self-start rounded-xl border border-line bg-surface p-4">
      <h2 className="display text-[1.2rem] font-semibold text-text">{l('Проба', 'Try it')}</h2>
      <p className="mt-1 text-[0.86rem] leading-relaxed text-text-2">{l('Напиши сообщение, будто оно из чата, и посмотри, что бы ответил Brackets. В чат ничего не отправляется.', 'Type a message as if it came from chat and see what Brackets would answer. Nothing is sent to chat.')}</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) void run()
        }}
      >
        <input className={inputCls} aria-label={l('Сообщение из чата', 'A chat message')} value={message} placeholder={placeholder} onChange={(e) => setMessage(e.target.value)} />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Spinner className="text-on-petal" /> : <Sparkles size={15} aria-hidden />}
          {l('Ответить', 'Answer')}
        </Button>
      </form>

      <div className="mt-3 flex flex-col gap-2">
        {busy && !samples && <div className="live py-2 text-[0.92rem] font-medium">{l('пишет три ответа…', 'writing three replies…')}</div>}
        {samples?.map((s, i) =>
          s.ok ? (
            <div key={i} className={cn('rounded-lg border-l-[3px] border-petal bg-petal-soft px-3 py-2', busy && 'opacity-50')}>
              <div className="selectable text-[1rem] leading-snug font-medium break-words text-text">{s.text}</div>
              <div className="num mt-1 truncate text-[0.8rem] text-text-3">
                {s.via} {(s.ms / 1000).toFixed(1)} {l('с', 's')}
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-lg border-l-[3px] border-danger bg-danger-soft px-3 py-2">
              <div className="text-[0.88rem] font-medium text-danger">{l('Ответ не получился', 'No usable reply')}</div>
              <div className="selectable mt-0.5 text-[0.82rem] leading-snug break-words text-text-2">{s.error}</div>
            </div>
          )
        )}
      </div>

      <details
        className="mt-4 border-t border-line pt-3"
        onToggle={(e) => {
          if (e.currentTarget.open) void api.llm.prompt(message).then(setPrompt)
        }}
      >
        <summary className="text-[0.88rem] text-text-2 hover:text-text">{l('Что получает нейросеть', 'What the model is given')}</summary>
        {prompt && (
          <div className="mt-2 flex flex-col gap-2">
            <pre className="selectable max-h-72 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[0.76rem] leading-relaxed whitespace-pre-wrap text-text-2">{prompt.system}</pre>
            <pre className="selectable max-h-48 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[0.76rem] leading-relaxed whitespace-pre-wrap text-text-2">{prompt.user}</pre>
          </div>
        )}
      </details>
    </aside>
  )
}

export function Style() {
  const l = useL()
  const p = useApp((s) => s.settings!.persona)
  const maxChars = useApp((s) => s.settings!.behavior.maxChars)
  const patch = useApp((s) => s.patch)
  const set = (persona: Partial<typeof p>): void => patch({ persona })
  const bracketWord = p.brackets === 0 ? l('никогда', 'never') : p.brackets < 30 ? l('редко', 'rarely') : p.brackets < 60 ? l('через раз', 'every other time') : p.brackets < 90 ? l('часто', 'often') : l('почти всегда', 'almost always')

  return (
    <Page wide>
      <PageHeader title={l('Стиль', 'Style')} description={l('Как Brackets пишет от твоего имени. Чем точнее описание и чем больше твоих настоящих сообщений, тем меньше отличий от тебя.', 'How Brackets writes in your name. The closer the description and the more of your real messages, the less it differs from you.')}>
        <Button variant="ghost" size="sm" onClick={() => void api.settings.reset('persona').then((s) => useApp.setState({ settings: s }))}>
          <RotateCcw size={14} aria-hidden />
          {l('Вернуть как было', 'Reset')}
        </Button>
      </PageHeader>

      <div className="flex items-start gap-8">
        <div className="min-w-0 flex-1">
          <Section title={l('Кто ты в чате', 'Who you are in the chat')} description={l('На своём канале Brackets отвечает зрителям от лица автора: на «классный стрим» скажет спасибо или отшутится. В чужом чате он пишет как один из зрителей.', 'On your own channel Brackets answers viewers as the streamer: "great stream" gets a thank-you or a joke. In someone else’s chat it writes as one of the viewers.')}>
            <Segmented
              label={l('Кто ты в чате', 'Who you are in the chat')}
              value={p.role}
              options={[
                { value: 'auto', label: l('Сам поймёт', 'Work it out'), title: l('Свой канал: автор. Чужой: зритель.', 'Your own channel: the streamer. Someone else’s: a viewer.') },
                { value: 'creator', label: l('Автор канала', 'The streamer') },
                { value: 'viewer', label: l('Зритель', 'A viewer') }
              ]}
              onChange={(role) => set({ role })}
            />
          </Section>

          <Section title={l('Как ты пишешь', 'How you write')} description={l('Своими словами, как объяснил бы другу.', 'In your own words, the way you would explain it to a friend.')}>
            <TextArea ariaLabel={l('Как ты пишешь', 'How you write')} rows={4} value={p.about} onCommit={(about) => set({ about })} placeholder={l('пишу коротко и по-простому…', 'I write short and plain…')} />
          </Section>

          <Section title={l('Твои сообщения', 'Your messages')} description={l('По одному на строку. Нейросеть перенимает манеру, а не повторяет их.', 'One per line. The model picks up the manner; it does not repeat them.')}>
            <TextArea ariaLabel={l('Твои сообщения', 'Your messages')} rows={7} value={p.examples.join('\n')} onCommit={(text) => set({ examples: text.split('\n').map((x) => x.trim()).filter(Boolean) })} placeholder={l('ну типо да)', 'yeah kinda)')} />
            <Switch checked={p.learnFromMe} onChange={(learnFromMe) => set({ learnFromMe })} label={l('Учиться на том, что я пишу сам', 'Learn from what I type myself')} description={l('Когда ты пишешь в чат с этого аккаунта, пока Brackets в нём сидит, он запоминает сообщение как ещё один пример.', 'When you write in chat from this account while Brackets sits in it, the message is kept as one more example.')} />
            {p.learned.length > 0 && (
              <div className="mt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[0.84rem] text-text-2">{l(`Запомнено из чата: ${p.learned.length}`, `Picked up from chat: ${p.learned.length}`)}</span>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => set({ learned: [] })}>
                    {l('Забыть все', 'Forget all')}
                  </Button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.learned.map((line) => (
                    <span key={line} className="inline-flex max-w-full items-center gap-1 rounded-md bg-sunken py-0.5 pr-1 pl-2 text-[0.84rem] text-text-2">
                      <span className="truncate">{line}</span>
                      <button type="button" aria-label={l(`Забыть: ${line}`, `Forget: ${line}`)} className="rounded p-0.5 text-text-3 hover:bg-petal-soft hover:text-text" onClick={() => set({ learned: p.learned.filter((x) => x !== line) })}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section title={l('Привычки', 'Habits')}>
            <Slider label={l('Скобка в конце', 'A bracket at the end')} hint={l('Закрывающая скобка вместо смайлика: «ну да)». Brackets ставит её сам, даже если нейросеть забудет.', 'A closing bracket in place of a smiley: "yeah)". Brackets adds it itself even when the model forgets.')} value={p.brackets} min={0} max={100} step={5} onChange={(brackets) => set({ brackets })} format={() => bracketWord} />
            <Slider label={l('Длина ответа', 'Reply length')} hint={l(`Сколько слов самое большее. Ответ длиннее ${maxChars} символов обрезается (это на странице «Поведение»).`, `The most words in a reply. Anything over ${maxChars} characters is cut (that is on the Behavior page).`)} value={p.maxWords} min={2} max={40} onChange={(maxWords) => set({ maxWords })} format={(v) => l(`до ${v} слов`, `up to ${v} words`)} />
            <Switch checked={p.lowercase} onChange={(lowercase) => set({ lowercase })} label={l('Только строчные буквы', 'Lowercase only')} description={l('Эмоуты вроде KEKW остаются как есть.', 'Emotes such as KEKW stay as they are.')} />
            <Switch checked={p.noPeriod} onChange={(noPeriod) => set({ noPeriod })} label={l('Без точки в конце', 'No full stop at the end')} />
            <Switch checked={p.emoji} onChange={(emoji) => set({ emoji })} label={l('Можно эмодзи', 'Emoji allowed')} description={l('Выключено: эмодзи вырезаются из ответа.', 'Off: emoji are stripped from the reply.')} />
            <Switch checked={p.swearing} onChange={(swearing) => set({ swearing })} label={l('Можно мат', 'Swearing allowed')} description={l('Выключено: нейросеть просят не материться, даже если чат матерится. Чтобы точно не пропустить слово, добавь его в стоп-слова на странице «Поведение».', 'Off: the model is asked to keep it clean even when the chat does not. To be sure a word never gets through, add it to the blocked words on the Behavior page.')} />
            <Field label={l('Аккуратность', 'Tidiness')}>
              <Segmented
                label={l('Аккуратность', 'Tidiness')}
                value={String(p.typos) as '0' | '1' | '2'}
                options={[
                  { value: '0', label: l('Грамотно', 'Tidy') },
                  { value: '1', label: l('Небрежно', 'Careless') },
                  { value: '2', label: l('Как с телефона', 'Like on a phone') }
                ]}
                onChange={(v) => set({ typos: Number(v) as 0 | 1 | 2 })}
              />
            </Field>
            <Field label={l('О себе по-русски', 'Yourself, in Russian')} hint={l('В русском по словам «рад» и «рада» виден пол. Без рода: Brackets таких слов избегает.', 'Russian words such as "рад" and "рада" show the speaker’s gender. Neutral: Brackets avoids them.')}>
              <Segmented
                label={l('О себе по-русски', 'Yourself, in Russian')}
                value={p.gender}
                options={[
                  { value: 'neutral', label: l('Без рода', 'Neutral') },
                  { value: 'm', label: l('Он', 'He') },
                  { value: 'f', label: l('Она', 'She') }
                ]}
                onChange={(gender) => set({ gender })}
              />
            </Field>
            <Field label={l('Язык ответов', 'Reply language')}>
              <Segmented
                label={l('Язык ответов', 'Reply language')}
                value={p.lang}
                options={[
                  { value: 'auto', label: l('Как в чате', 'Same as the chat') },
                  { value: 'ru', label: 'Русский' },
                  { value: 'en', label: 'English' }
                ]}
                onChange={(lang) => set({ lang })}
              />
            </Field>
            <Field label={l('Эмоуты', 'Emotes')} hint={l('Какие эмоуты канала можно вставлять. Пиши точно как в чате: KEKW, а не kekw.', 'Which channel emotes it may use. Spell them exactly as in chat: KEKW, not kekw.')}>
              <TagInput ariaLabel={l('Эмоуты', 'Emotes')} values={p.emotes} onChange={(emotes) => set({ emotes })} placeholder={l('эмоут и Enter', 'emote, then Enter')} />
            </Field>
          </Section>

          <Section title={l('Свой промпт', 'Your own prompt')} description={l('Для тех, кто хочет написать инструкцию нейросети целиком сам.', 'For those who want to write the whole instruction for the model themselves.')}>
            <Switch checked={p.useCustomPrompt} onChange={(useCustomPrompt) => set({ useCustomPrompt })} label={l('Использовать свой промпт', 'Use my own prompt')} description={l('Заменяет всё, что выше на этой странице, кроме скобок, строчных букв и других правок готового ответа.', 'Replaces everything above on this page, except the brackets, lowercase and the other touches made to the finished reply.')} />
            {p.useCustomPrompt && (
              <>
                <TextArea ariaLabel={l('Свой промпт', 'Your own prompt')} mono rows={9} value={p.customPrompt} onCommit={(customPrompt) => set({ customPrompt })} placeholder={l('Ты зритель {login} в чате {channel}…', 'You are the viewer {login} in the chat of {channel}…')} />
                <p className="mt-1.5 text-[0.82rem] leading-relaxed text-text-3">
                  {l('Подставляется само: ', 'Filled in for you: ')}
                  <span className="selectable font-mono text-[0.78rem]">{'{login} {channel} {title} {game} {about} {examples} {max_words} {max_chars}'}</span>
                </p>
              </>
            )}
          </Section>
        </div>
        <TryIt />
      </div>
    </Page>
  )
}
