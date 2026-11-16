// Draws the Brackets mark (a chat bubble with two closing brackets) and writes it as the app icon,
// the Windows .ico and the tray icons. No image library: the shapes are computed pixel by pixel.
// The same drawing, as SVG, is src/renderer/src/components/Mark.tsx — keep the two alike.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources')
mkdirSync(out, { recursive: true })

// The drawing lives on a 64 x 64 grid.
const BUBBLE = { x0: 4, y0: 6, x1: 60, y1: 50, r: 12 }
const TAIL = [
  [15, 48],
  [15, 61],
  [30, 48]
]
const BRACKETS = [
  { cx: 11, cy: 28, r: 17, half: 50, width: 5.4, color: [255, 255, 255] },
  { cx: 24, cy: 28, r: 17, half: 50, width: 5.4, color: [242, 181, 68] }
]
const TOP = [146, 124, 255]
const BOTTOM = [104, 78, 224]

function inRoundRect(x, y, b) {
  if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false
  const cx = Math.min(Math.max(x, b.x0 + b.r), b.x1 - b.r)
  const cy = Math.min(Math.max(y, b.y0 + b.r), b.y1 - b.r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= b.r ** 2
}

function inTriangle(x, y, [a, b, c]) {
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
  const p = [x, y]
  const d1 = sign(p, a, b)
  const d2 = sign(p, b, c)
  const d3 = sign(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

// A bracket is the right-hand part of a circle, drawn as a thick line with round ends.
function onBracket(x, y, k) {
  const a = (k.half * Math.PI) / 180
  const angle = Math.atan2(y - k.cy, x - k.cx)
  let d
  if (Math.abs(angle) <= a) d = Math.abs(Math.hypot(x - k.cx, y - k.cy) - k.r)
  else {
    const ex = k.cx + k.r * Math.cos(a)
    const ey = k.cy + k.r * Math.sin(a) * Math.sign(angle || 1)
    d = Math.hypot(x - ex, y - ey)
  }
  return d <= k.width / 2
}

function colorAt(x, y) {
  for (let i = BRACKETS.length - 1; i >= 0; i--) if (onBracket(x, y, BRACKETS[i])) return BRACKETS[i].color
  if (inRoundRect(x, y, BUBBLE) || inTriangle(x, y, TAIL)) {
    const t = Math.min(1, Math.max(0, (y - BUBBLE.y0) / (61 - BUBBLE.y0)))
    return TOP.map((c, i) => c + (BOTTOM[i] - c) * t)
  }
  return null
}

function render(size) {
  const ss = size >= 128 ? 3 : 5
  const rgba = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt(((px + (sx + 0.5) / ss) * 64) / size, ((py + (sy + 0.5) / ss) * 64) / size)
          if (!c) continue
          r += c[0]
          g += c[1]
          b += c[2]
          hits++
        }
      }
      const i = (py * size + px) * 4
      if (hits) {
        rgba[i] = Math.round(r / hits)
        rgba[i + 1] = Math.round(g / hits)
        rgba[i + 2] = Math.round(b / hits)
        rgba[i + 3] = Math.round((hits / (ss * ss)) * 255)
      }
    }
  }
  return rgba
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

function png(size) {
  const rgba = render(size)
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const head = Buffer.alloc(13)
  head.writeUInt32BE(size, 0)
  head.writeUInt32BE(size, 4)
  head.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function ico(sizes) {
  const images = sizes.map((s) => png(s))
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach((img, i) => {
    const at = 6 + 16 * i
    head[at] = sizes[i] >= 256 ? 0 : sizes[i]
    head[at + 1] = sizes[i] >= 256 ? 0 : sizes[i]
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(img.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += img.length
  })
  return Buffer.concat([head, ...images])
}

writeFileSync(path.join(out, 'icon.png'), png(512))
writeFileSync(path.join(out, 'icon.ico'), ico([256, 128, 64, 48, 32, 24, 16]))
writeFileSync(path.join(out, 'tray.png'), png(32))
writeFileSync(path.join(out, 'tray@2x.png'), png(64))
console.log('resources/icon.png, icon.ico, tray.png, tray@2x.png')
