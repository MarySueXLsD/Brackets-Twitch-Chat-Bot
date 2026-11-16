// Starts the bundled router on Electron's own Node with a throwaway database and checks that it
// boots, lists providers and answers a chat request. Run after `npm run router`, and again after
// moving to a newer FreeLLMAPI release:  node scripts/smoke-router.mjs [--chat] [--wait=20] [--model=auto:fast] [--log]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electron = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const bundle = path.join(root, 'out', 'router', 'router.mjs')
if (!existsSync(bundle)) {
  console.error('out/router/router.mjs is missing. Run: npm run router')
  process.exit(1)
}
const data = mkdtempSync(path.join(tmpdir(), 'brackets-router-'))
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', BRACKETS_ROUTER_DB: path.join(data, 'freeapi.db'), BRACKETS_ROUTER_CLIENT: path.join(root, 'out', 'router', 'client'), BRACKETS_ROUTER_PORT: '31917', FREEAPI_ENV_PATH: path.join(data, 'none.env') }
delete env.NODE_ENV

const child = spawn(electron, [bundle], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
const lines = []
const keep = (chunk) => String(chunk).split(/\r?\n/).filter(Boolean).forEach((l) => lines.push(l))
child.stdout.on('data', keep)
child.stderr.on('data', keep)

let failed = false
const finish = (code) => {
  child.kill()
  setTimeout(() => {
    rmSync(data, { recursive: true, force: true })
    process.exit(code)
  }, 400)
}
const timer = setTimeout(() => {
  console.error('The router did not report ready within 40 seconds. Its output:\n' + lines.slice(-30).join('\n'))
  finish(1)
}, 40000)

child.on('exit', (code) => {
  if (!failed && code) {
    console.error(`The router exited with code ${code}. Its output:\n` + lines.slice(-30).join('\n'))
    process.exit(1)
  }
})

child.on('message', async (m) => {
  if (m.type === 'failed') {
    failed = true
    console.error('The router failed to start: ' + m.error + '\n' + lines.slice(-30).join('\n'))
    return finish(1)
  }
  if (m.type !== 'ready') return
  clearTimeout(timer)
  const base = `http://127.0.0.1:${m.port}`
  console.log(`ready on port ${m.port}; unified key ${m.unifiedKey ? 'received' : 'MISSING'}; session ${m.sessionToken ? 'received' : 'MISSING'}`)
  try {
    const admin = { Authorization: `Bearer ${m.sessionToken}` }
    const providers = await (await fetch(`${base}/api/keys/providers`, { headers: admin })).json()
    const list = providers.providers ?? []
    console.log(`providers: ${list.length} listed, ${list.filter((p) => p.keyless).length} need no key, ${list.filter((p) => p.configured).length} configured`)
    console.log('keyless: ' + list.filter((p) => p.keyless).map((p) => `${p.platform}${p.configured ? '*' : ''}`).join(', '))

    const models = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${m.unifiedKey}` } })
    const body = await models.json()
    console.log(`/v1/models: HTTP ${models.status}, ${(body.data ?? []).length} models`)

    const page = await fetch(`${base}/`)
    console.log(`dashboard: HTTP ${page.status} ${page.headers.get('content-type')}`)

    if (process.argv.includes('--chat')) {
      // What the app does on first start: switch on the chat providers that need no key.
      for (const p of list.filter((x) => x.keyless && x.kind === 'chat')) {
        const added = await fetch(`${base}/api/keys`, { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: p.platform }) })
        const info = await added.json().catch(() => ({}))
        console.log(`  + ${p.platform}: HTTP ${added.status}, ${info.modelsAvailable ?? '?'} models${info.notice ? ' (' + info.notice + ')' : ''}`)
      }
      // --wait=20 gives the router time to fetch its model catalog before the request.
      const wait = Number((process.argv.find((a) => a.startsWith('--wait=')) ?? '').slice(7)) || 0
      if (wait) await new Promise((r) => setTimeout(r, wait * 1000))
      if (process.argv.includes('--log')) console.log('--- router log ---\n' + lines.slice(-40).join('\n') + '\n---')
      const started = Date.now()
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${m.unifiedKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: (process.argv.find((a) => a.startsWith('--model=')) ?? '--model=auto').slice(8), max_tokens: 200, messages: [{ role: 'user', content: 'Reply with exactly: ok' }] })
      })
      const text = await res.text()
      console.log(`chat: HTTP ${res.status} in ${Date.now() - started} ms, via ${res.headers.get('x-routed-via')}\n${text.slice(0, 600)}`)
    }
    finish(0)
  } catch (err) {
    console.error('request failed: ' + (err?.stack ?? err) + '\n' + lines.slice(-30).join('\n'))
    finish(1)
  }
})
