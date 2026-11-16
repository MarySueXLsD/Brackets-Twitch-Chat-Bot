// The rhythm strip: the chat drawn the way a step sequencer draws a beat. Every message is a tick,
// every reply a lit pad above it, and a playhead marks now. Ahead of the playhead lies the pause
// after the last reply; when the playhead leaves it, the next message may get an answer.
import { useEffect, useRef } from 'react'
import { beats, useApp, useLang } from '../store'

interface Palette {
  text: string
  text2: string
  text3: string
  line: string
  petal: string
  petalSoft: string
  pollen: string
  pollenSoft: string
  sunken: string
  font: string
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string): string => cs.getPropertyValue(name).trim()
  return { text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), line: v('--line'), petal: v('--petal'), petalSoft: v('--petal-soft'), pollen: v('--pollen'), pollenSoft: v('--pollen-soft'), sunken: v('--sunken'), font: v('--font-display') || 'Bahnschrift, sans-serif' }
}

/** Where "now" sits across the strip; the rest, to the right, is what lies ahead. */
const NOW = 0.84

export function Rhythm({ spanMin }: { spanMin: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const lang = useLang()
  const theme = useApp((s) => `${s.settings?.ui.theme}|${s.settings?.ui.scheme}`)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let palette = readPalette()
    let raf = 0
    let last = 0
    let w = 0
    let h = 0
    const ru = lang === 'ru'

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      w = Math.max(1, rect.width)
      h = Math.max(1, rect.height)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const observer = new ResizeObserver(() => {
      resize()
      last = 0
    })
    observer.observe(canvas)
    resize()
    // The theme's variables are applied a moment after this effect runs.
    const repaint = setTimeout(() => {
      palette = readPalette()
      last = 0
    }, 60)

    const draw = (): void => {
      const st = useApp.getState().status
      const now = Date.now()
      const span = spanMin * 60000
      const nowX = Math.round(w * NOW)
      const pxPerMs = nowX / span
      const x = (t: number): number => nowX + (t - now) * pxPerMs
      const running = st?.state === 'running'
      const padY = 15
      const base = h - 20
      const top = 32

      ctx.clearRect(0, 0, w, h)

      // What lies ahead of the playhead.
      if (running && st) {
        const held = st.pausedUntil > now
        const until = held ? st.pausedUntil : st.nextWindowAt
        if (until > now) {
          // The pause: hatched, up to the moment it ends.
          const end = Math.min(w, x(until))
          ctx.save()
          ctx.beginPath()
          ctx.rect(nowX, top - 6, end - nowX, base - top + 6)
          ctx.clip()
          ctx.fillStyle = palette.sunken
          ctx.fillRect(nowX, top - 6, end - nowX, base - top + 6)
          ctx.strokeStyle = palette.line
          ctx.lineWidth = 1
          for (let i = nowX - h; i < end; i += 7) {
            ctx.beginPath()
            ctx.moveTo(i, base)
            ctx.lineTo(i + (base - top + 6), top - 6)
            ctx.stroke()
          }
          ctx.restore()
          if (end < w) {
            ctx.fillStyle = palette.pollenSoft
            ctx.fillRect(end, top - 6, w - end, base - top + 6)
            ctx.fillStyle = palette.pollen
            ctx.fillRect(end, top - 6, 1.5, base - top + 6)
          }
        } else {
          // No pause left: the next message that fits gets an answer.
          ctx.fillStyle = palette.pollenSoft
          ctx.fillRect(nowX, top - 6, w - nowX, base - top + 6)
        }
      }

      // Minute lines and their labels.
      ctx.font = `500 11px ${palette.font}`
      ctx.textBaseline = 'alphabetic'
      const step = spanMin <= 2 ? 30000 : spanMin <= 5 ? 60000 : 180000
      for (let ago = step; ago < span; ago += step) {
        const gx = Math.round(x(now - ago)) + 0.5
        ctx.strokeStyle = palette.line
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(gx, top - 6)
        ctx.lineTo(gx, base)
        ctx.stroke()
        ctx.fillStyle = palette.text3
        ctx.textAlign = 'center'
        const sec = ago / 1000
        ctx.fillText(sec < 60 ? `−${sec} ${ru ? 'с' : 's'}` : `−${sec / 60} ${ru ? 'мин' : 'min'}`, gx, h - 5)
      }
      ctx.strokeStyle = palette.line
      ctx.beginPath()
      ctx.moveTo(0, base + 0.5)
      ctx.lineTo(w, base + 0.5)
      ctx.stroke()

      // The beat itself. Newest last, so a reply is never hidden behind a tick.
      const from = now - span
      for (let i = beats.length - 1; i >= 0; i--) {
        const b = beats[i]
        if (b.t < from) break
        const bx = x(b.t)
        if (b.k === 'm' || b.k === 'a') {
          const tall = 5 + b.w * (base - top - 8)
          ctx.fillStyle = b.k === 'a' ? palette.petal : palette.text3
          ctx.globalAlpha = b.k === 'a' ? 1 : 0.62
          ctx.beginPath()
          ctx.roundRect(bx - 1, base - tall, 2, tall, 1)
          ctx.fill()
          ctx.globalAlpha = 1
        } else {
          const fresh = Math.max(0, 1 - (now - b.t) / 900)
          const size = 11 + fresh * 5
          ctx.fillStyle = palette.petalSoft
          ctx.fillRect(bx - 0.75, padY, 1.5, base - padY)
          ctx.beginPath()
          ctx.roundRect(bx - size / 2, padY - size / 2, size, size, 3)
          if (b.k === 'r') {
            ctx.fillStyle = palette.petal
            if (fresh > 0) {
              ctx.shadowColor = palette.petal
              ctx.shadowBlur = 16 * fresh
            }
            ctx.fill()
            ctx.shadowBlur = 0
          } else {
            // A test reply was written but not sent: an outline only.
            ctx.strokeStyle = palette.petal
            ctx.lineWidth = 1.5
            ctx.stroke()
          }
        }
      }

      // The playhead.
      ctx.fillStyle = running ? palette.pollen : palette.text3
      ctx.fillRect(nowX - 0.75, 4, 1.5, base - 4)
      ctx.beginPath()
      ctx.moveTo(nowX - 5, 2)
      ctx.lineTo(nowX + 5, 2)
      ctx.lineTo(nowX, 9)
      ctx.closePath()
      ctx.fill()
      ctx.textAlign = 'center'
      ctx.fillText(ru ? 'сейчас' : 'now', nowX, h - 5)
    }

    const loop = (t: number): void => {
      raf = requestAnimationFrame(loop)
      // Ten frames a second is smooth enough for a strip that moves a pixel a second.
      if (t - last < 100 || document.hidden) return
      last = t
      draw()
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(repaint)
      observer.disconnect()
    }
  }, [spanMin, lang, theme])

  return <canvas ref={ref} className="block h-[104px] w-full" role="img" aria-label={lang === 'ru' ? 'Ритм чата: сообщения и ответы за последние минуты' : 'Chat rhythm: messages and replies over the last minutes'} />
}
