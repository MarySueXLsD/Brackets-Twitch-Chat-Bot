// Colour themes. "brackets" follows the light or dark setting with the palettes in styles.css (the same
// violet and gold as Maris); every other theme is a whole palette built from five colours, and
// "graphite", "taiga", "sunset" and "oled" come from SensePad.

export type Scheme = 'light' | 'dark'

export interface ThemeTokens {
  scheme: Scheme
  text: string
  text2: string
  text3: string
  paper: string
  side: string
  surface: string
  raised: string
  sunken: string
  line: string
  lineStrong: string
  petal: string
  petalStrong: string
  petalSoft: string
  onPetal: string
  pollen: string
  pollenSoft: string
  danger: string
  dangerSoft: string
  ok: string
  okSoft: string
  shadow: string
  /** Neon themes light up primary buttons and the playhead. */
  glow: boolean
}

export interface ThemeColors {
  scheme: Scheme
  background: string
  surface: string
  text: string
  accent: string
  highlight: string
  glow: boolean
}

export interface ThemeDef {
  id: string
  ru: string
  en: string
  colors?: ThemeColors
  tokens?: ThemeTokens
}

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = Number.parseInt(h.slice(0, 6), 16)
  if (!Number.isFinite(n)) return [128, 128, 128]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hex = ([r, g, b]: [number, number, number]): string =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
export const alpha = (c: string, a: number): string => {
  const [r, g, b] = rgb(c)
  return `rgb(${r} ${g} ${b} / ${a})`
}
/** Mix two colours; t = 0 gives a, t = 1 gives b. */
export const mix = (a: string, b: string, t: number): string => {
  const x = rgb(a)
  const y = rgb(b)
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}
export function luminance(c: string): number {
  const ch = rgb(c).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** A whole palette from five colours. */
export function tokensFromColors(c: ThemeColors): ThemeTokens {
  const dark = c.scheme === 'dark'
  return {
    scheme: c.scheme,
    text: c.text,
    text2: mix(c.text, c.background, 0.32),
    text3: mix(c.text, c.background, 0.52),
    paper: c.background,
    side: mix(c.background, dark ? '#000000' : c.text, dark ? 0.14 : 0.03),
    surface: c.surface,
    raised: dark ? mix(c.surface, c.text, 0.07) : mix(c.surface, '#ffffff', 0.6),
    sunken: dark ? 'rgb(0 0 0 / 0.22)' : alpha(c.text, 0.05),
    line: alpha(c.text, dark ? 0.12 : 0.1),
    lineStrong: alpha(c.text, dark ? 0.22 : 0.18),
    petal: c.accent,
    petalStrong: dark ? c.accent : mix(c.accent, '#000000', 0.1),
    petalSoft: alpha(c.accent, dark ? 0.16 : 0.11),
    onPetal: contrast(c.accent, '#ffffff') >= contrast(c.accent, '#0d0b14') ? '#ffffff' : '#0d0b14',
    pollen: c.highlight,
    pollenSoft: alpha(c.highlight, dark ? 0.15 : 0.18),
    danger: dark ? '#ff8597' : '#c62f45',
    dangerSoft: dark ? 'rgb(255 133 151 / 0.12)' : 'rgb(198 47 69 / 0.1)',
    ok: dark ? '#72d6a8' : '#1e8a5a',
    okSoft: dark ? 'rgb(114 214 168 / 0.12)' : 'rgb(30 138 90 / 0.1)',
    shadow: dark ? '0 1px 2px rgb(0 0 0 / 0.3), 0 10px 32px rgb(0 0 0 / 0.32)' : `0 1px 2px ${alpha(c.text, 0.06)}, 0 8px 28px ${alpha(c.text, 0.08)}`,
    glow: c.glow
  }
}

const def = (id: string, ru: string, en: string, scheme: Scheme, background: string, surface: string, text: string, accent: string, highlight: string, glow = false): ThemeDef => {
  const colors: ThemeColors = { scheme, background, surface, text, accent, highlight, glow }
  return { id, ru, en, colors, tokens: tokensFromColors(colors) }
}

export const THEMES: ThemeDef[] = [
  { id: 'brackets', ru: 'Brackets', en: 'Brackets' },
  def('graphite', 'Графит', 'Graphite', 'dark', '#1d1d20', '#26262a', '#f0f0ee', '#5eead4', '#fbbf24'),
  def('neon', 'Неон', 'Neon', 'dark', '#0b0614', '#120a22', '#f1e9ff', '#c06bff', '#39f0ff', true),
  def('midnight', 'Полночь', 'Midnight', 'dark', '#0d0f16', '#12151e', '#e9ecf2', '#5aa9ff', '#ffcf5a'),
  def('taiga', 'Тайга', 'Taiga', 'dark', '#101715', '#151e1b', '#e8f1eb', '#46d39a', '#f2c14e'),
  def('sunset', 'Закат', 'Sunset', 'dark', '#1b1219', '#231821', '#f7edef', '#ff7aa8', '#ffb86b'),
  def('oled', 'OLED', 'OLED', 'dark', '#000000', '#09090b', '#eceef3', '#a493ff', '#f2b544'),
  def('daylight', 'День', 'Daylight', 'light', '#eef0f4', '#ffffff', '#161a22', '#5b3fd6', '#a86a08')
]

/** What the theme cards show for the built-in Brackets palettes. */
export const BRAND_PREVIEW: Record<Scheme, { paper: string; side: string; raised: string; text: string; text3: string; petal: string; pollen: string }> = {
  light: { paper: '#f4f3f9', side: '#ecebf3', raised: '#ffffff', text: '#1b1830', text3: '#8a86a0', petal: '#6a4fe0', pollen: '#a86a08' },
  dark: { paper: '#15131f', side: '#110f19', raised: '#232036', text: '#ecebf6', text3: '#77738f', petal: '#a493ff', pollen: '#f2b544' }
}

export const themeTokens = (id: string): ThemeTokens | undefined => THEMES.find((t) => t.id === id)?.tokens

/** CSS custom properties for a palette (the names match styles.css). */
export function cssVars(t: ThemeTokens): Record<string, string> {
  return {
    '--text': t.text,
    '--text-2': t.text2,
    '--text-3': t.text3,
    '--paper': t.paper,
    '--side': t.side,
    '--surface': t.surface,
    '--raised': t.raised,
    '--sunken': t.sunken,
    '--line': t.line,
    '--line-strong': t.lineStrong,
    '--petal': t.petal,
    '--petal-strong': t.petalStrong,
    '--petal-soft': t.petalSoft,
    '--on-petal': t.onPetal,
    '--pollen': t.pollen,
    '--pollen-soft': t.pollenSoft,
    '--danger': t.danger,
    '--danger-soft': t.dangerSoft,
    '--ok': t.ok,
    '--ok-soft': t.okSoft,
    '--shadow': t.shadow
  }
}
