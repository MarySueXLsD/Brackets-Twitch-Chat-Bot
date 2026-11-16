import { clsx, type ClassValue } from 'clsx'
import { X } from 'lucide-react'
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

export const cn = (...v: ClassValue[]): string => clsx(v)

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle'
  size?: 'sm' | 'md'
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'outline', size = 'md', className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      {...rest}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-[0.85rem]' : 'h-9 px-4 text-[0.92rem]',
        variant === 'primary' && 'glowable bg-petal-strong text-on-petal hover:bg-petal',
        variant === 'outline' && 'border border-line-strong text-text hover:bg-sunken',
        variant === 'ghost' && 'text-text-2 hover:bg-sunken hover:text-text',
        variant === 'subtle' && 'bg-sunken text-text hover:bg-petal-soft',
        variant === 'danger' && 'bg-danger-soft text-danger hover:bg-danger hover:text-white',
        className
      )}
    />
  )
})

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-6 py-2.5', disabled && 'cursor-not-allowed opacity-50')}>
      <span className="min-w-0">
        <span className="block text-[0.95rem] text-text">{label}</span>
        {description && <span className="mt-0.5 block max-w-[60ch] text-[0.84rem] leading-snug text-text-2">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-[22px] w-[40px] shrink-0 rounded-full border transition-colors', checked ? 'border-petal-strong bg-petal-strong' : 'border-line-strong bg-sunken')}
      >
        <span className={cn('absolute top-[3px] left-0 block size-[14px] rounded-full transition-transform', checked ? 'translate-x-[21px] bg-on-petal' : 'translate-x-[3px] bg-text-2')} />
      </button>
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn('rounded-md px-3 font-medium whitespace-nowrap transition-colors', size === 'sm' ? 'h-7 text-[0.8rem]' : 'h-8 text-[0.88rem]', value === o.value ? 'bg-raised text-text shadow-sm' : 'text-text-2 hover:text-text')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('size-4 animate-spin text-pollen', className)} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export const inputCls = 'w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-[0.95rem] text-text placeholder:text-text-3 focus:border-petal focus:outline-none'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="text-[0.95rem] text-text">{label}</div>
      {hint && <div className="mt-0.5 max-w-[60ch] text-[0.84rem] leading-snug text-text-2">{hint}</div>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

export function Section({ title, description, children, aside }: { title: string; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-line py-6 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="display text-[1.2rem] font-semibold text-text">{title}</h2>
          {description && <p className="mt-1 max-w-[62ch] text-[0.88rem] leading-relaxed text-text-2">{description}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        <h1 className="display text-[2rem] leading-tight font-semibold text-text">{title}</h1>
        {description && <p className="mt-1.5 max-w-[64ch] text-[0.92rem] leading-relaxed text-text-2">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  )
}

/** A page of settings: one readable column that scrolls. */
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('mx-auto px-8 pt-3 pb-12', wide ? 'max-w-[1120px]' : 'max-w-[760px]')}>{children}</div>
    </div>
  )
}

export function Slider({ label, hint, value, min, max, step = 1, onChange, format }: { label: string; hint?: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[0.95rem] text-text">{label}</span>
        <span className="num text-[1.05rem] text-text">{format ? format(value) : value}</span>
      </div>
      {hint && <div className="mt-0.5 max-w-[60ch] text-[0.84rem] leading-snug text-text-2">{hint}</div>}
      <input type="range" aria-label={label} className="mt-1.5 w-full" min={min} max={max} step={step} value={value} style={{ ['--fill' as string]: `${fill}%` }} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

/** Steps for a slider of durations: fine at the short end, coarse at the long one. */
export const SECONDS = [5, 8, 10, 12, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 420, 480, 600, 720, 840, 900, 1200, 1500, 1800]

/** A slider over a fixed list of values, so 15 seconds and 15 minutes both get room on the track. */
export function StepSlider({ label, hint, value, steps, onChange, format }: { label: string; hint?: ReactNode; value: number; steps: number[]; onChange: (v: number) => void; format: (v: number) => string }) {
  // The nearest step stands in for a value that is not on the list (set by a preset or by hand).
  let index = 0
  for (let i = 0; i < steps.length; i++) if (Math.abs(steps[i] - value) < Math.abs(steps[index] - value)) index = i
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[0.95rem] text-text">{label}</span>
        <span className="num text-[1.05rem] text-text">{format(value)}</span>
      </div>
      {hint && <div className="mt-0.5 max-w-[60ch] text-[0.84rem] leading-snug text-text-2">{hint}</div>}
      <input type="range" aria-label={label} aria-valuetext={format(value)} className="mt-1.5 w-full" min={0} max={steps.length - 1} step={1} value={index} style={{ ['--fill' as string]: `${(index / (steps.length - 1)) * 100}%` }} onChange={(e) => onChange(steps[Number(e.target.value)])} />
    </div>
  )
}

/** A text box that saves as you type but never loses a keystroke to a slow answer. */
export function TextInput({ value, onCommit, placeholder, className, type = 'text', ariaLabel, mono }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string; type?: 'text' | 'password'; ariaLabel?: string; mono?: boolean }) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])
  return (
    <input
      type={type}
      aria-label={ariaLabel}
      spellCheck={false}
      className={cn(inputCls, mono && 'font-mono text-[0.88rem]', className)}
      value={text}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        if (text !== value) onCommit(text)
      }}
      onChange={(e) => {
        setText(e.target.value)
        onCommit(e.target.value)
      }}
    />
  )
}

export function TextArea({ value, onCommit, placeholder, rows = 3, ariaLabel, mono }: { value: string; onCommit: (v: string) => void; placeholder?: string; rows?: number; ariaLabel?: string; mono?: boolean }) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])
  return (
    <textarea
      aria-label={ariaLabel}
      spellCheck={false}
      rows={rows}
      className={cn(inputCls, 'selectable resize-y leading-relaxed', mono && 'font-mono text-[0.84rem]')}
      value={text}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        if (text !== value) onCommit(text)
      }}
      onChange={(e) => {
        setText(e.target.value)
        onCommit(e.target.value)
      }}
    />
  )
}

/** A list of short words (names, keywords): type one, press Enter. */
export function TagInput({ values, onChange, placeholder, ariaLabel }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; ariaLabel: string }) {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const parts = draft
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parts.length) return
    const next = [...values]
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
    setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1))
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-2 py-1.5 focus-within:border-petal">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-md bg-petal-soft py-0.5 pr-1 pl-2 text-[0.86rem] text-text">
          {v}
          <button type="button" aria-label={`× ${v}`} className="rounded p-0.5 text-text-3 hover:bg-sunken hover:text-text" onClick={() => onChange(values.filter((x) => x !== v))}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input aria-label={ariaLabel} spellCheck={false} className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-[0.92rem] text-text placeholder:text-text-3 focus:outline-none" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} />
    </div>
  )
}

/** A small coloured word: a state, a reason. */
export function Chip({ tone = 'plain', children, title }: { tone?: 'plain' | 'petal' | 'pollen' | 'ok' | 'danger'; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[1.35rem] shrink-0 items-center rounded-md px-1.5 text-[0.74rem] font-medium whitespace-nowrap',
        tone === 'plain' && 'bg-sunken text-text-2',
        tone === 'petal' && 'bg-petal-soft text-petal',
        tone === 'pollen' && 'bg-pollen-soft text-pollen',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'danger' && 'bg-danger-soft text-danger'
      )}
    >
      {children}
    </span>
  )
}

/** A link that opens in the system browser. Only addresses the app itself knows about go through. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button type="button" className="selectable inline text-left text-petal underline decoration-1 underline-offset-2 hover:decoration-2" onClick={() => void window.brackets.app.openExternal(href)}>
      {children}
    </button>
  )
}
