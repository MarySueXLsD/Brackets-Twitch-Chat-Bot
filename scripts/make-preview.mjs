// Makes docs/preview.gif, the moving picture at the top of the README, from the demo.
//
//   1. record the frames (a window opens for about twenty seconds and closes by itself):
//        set BRACKETS_SHOTS=shots  and  BRACKETS_SHOTS_FRAMES=14,  then  npx electron . --demo
//   2. node scripts/make-preview.mjs [folder with frames] [output.gif]
//
// Needs ffmpeg on PATH. The palette is built from the frames themselves, which is what keeps the
// dark interface from banding.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frames = path.resolve(process.argv[2] ?? path.join(root, 'shots', 'frames'))
const out = path.resolve(process.argv[3] ?? path.join(root, 'docs', 'preview.gif'))
const width = Number(process.env.PREVIEW_WIDTH) || 960

if (!existsSync(path.join(frames, 'f0000.png'))) {
  console.error(`No frames in ${frames}. Record them first; the steps are at the top of this file.`)
  process.exit(1)
}
mkdirSync(path.dirname(out), { recursive: true })
const filter = `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(frames, 'f%04d.png'), '-vf', filter, '-loop', '0', out], { stdio: 'inherit' })
console.log(`${path.relative(root, out)}  ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB`)
