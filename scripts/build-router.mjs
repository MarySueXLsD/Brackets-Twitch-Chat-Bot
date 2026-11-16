// Bundles router/host.ts and the FreeLLMAPI server behind it into out/router/router.mjs, and copies
// the FreeLLMAPI dashboard next to it. Needs vendor/freellmapi (npm run vendor).
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TAG, COMMIT } from './vendor.config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendor = path.join(root, 'vendor', 'freellmapi')
const out = path.join(root, 'out', 'router')

if (!existsSync(path.join(vendor, 'server', 'src', 'app.ts'))) {
  console.error('vendor/freellmapi is missing. Run: npm run vendor')
  process.exit(1)
}
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [path.join(root, 'router', 'host.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(out, 'router.mjs'),
  // better-sqlite3 is never loaded (the host passes the node:sqlite driver). sharp is only wanted
  // for pictures sent to a model, which this app never does; the server works without it.
  external: ['better-sqlite3', 'sharp'],
  define: {
    'process.env.FREELLMAPI_COMMIT_SHA': JSON.stringify(COMMIT),
    'process.env.FREELLMAPI_INSTALL_METHOD': JSON.stringify('desktop')
  },
  // Some bundled CommonJS packages (express internals) call require at run time.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  },
  legalComments: 'none',
  logLevel: 'warning'
})

cpSync(path.join(vendor, 'client', 'dist'), path.join(out, 'client'), { recursive: true })
cpSync(path.join(vendor, 'LICENSE'), path.join(out, 'FreeLLMAPI-LICENSE.txt'))
writeFileSync(path.join(out, 'version.json'), JSON.stringify({ tag: TAG, commit: COMMIT }, null, 2))

const kb = Math.round(readFileSync(path.join(out, 'router.mjs')).length / 1024)
console.log(`out/router/router.mjs  ${kb} kB  (FreeLLMAPI ${TAG})`)
