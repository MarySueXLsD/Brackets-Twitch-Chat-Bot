// The FreeLLMAPI router, embedded. scripts/build-router.mjs bundles this file and the whole server
// behind it into out/router/router.mjs, which the app starts as a child process (src/main/router.ts).
//
// It follows desktop/src/server-host.ts in the FreeLLMAPI repository step by step; keep the two in
// sync when moving to a newer release. Two things differ on purpose:
//   - the database runs on Node's own SQLite (node:sqlite), so nothing native has to be compiled;
//   - it reports to the app over the parent port instead of living inside an Electron main process.
import '../vendor/freellmapi/server/src/env.js'
import tls from 'node:tls'
import type { Server } from 'node:http'
import { createApp } from '../vendor/freellmapi/server/src/app.js'
import { initDb, getDb, getUnifiedApiKey } from '../vendor/freellmapi/server/src/db/index.js'
import { nodeSqliteFactory } from '../vendor/freellmapi/server/src/db/node-sqlite.js'
import { restoreProxySettings, flushProxyCache } from '../vendor/freellmapi/server/src/lib/proxy.js'
import { startHealthChecker, checkAllKeys } from '../vendor/freellmapi/server/src/services/health.js'
import { startCatalogSync } from '../vendor/freellmapi/server/src/services/catalog-sync.js'
import { startCooldownProbe } from '../vendor/freellmapi/server/src/services/cooldown-probe.js'
import { startModelProbe } from '../vendor/freellmapi/server/src/services/model-probe.js'
import { startCustomModelSync } from '../vendor/freellmapi/server/src/services/custom-model-sync.js'
import { startBuiltinModelDiscovery } from '../vendor/freellmapi/server/src/services/builtin-model-discovery.js'
import { startBackupScheduler } from '../vendor/freellmapi/server/src/services/backups.js'
import { cleanupExpiredCooldowns } from '../vendor/freellmapi/server/src/services/ratelimit.js'
import { loadCacheFromDb } from '../vendor/freellmapi/server/src/services/cache.js'
import { startWakeDetect } from '../vendor/freellmapi/server/src/lib/wake-detect.js'
import { installProcessSafetyNet } from '../vendor/freellmapi/server/src/lib/process-safety-net.js'
import { installLogRedaction } from '../vendor/freellmapi/server/src/lib/log-redaction.js'
import { desktopSessionToken } from '../vendor/freellmapi/server/src/services/auth.js'
import { NodeScheduler } from '../vendor/freellmapi/server/src/lib/scheduler.js'

type ParentPort = { postMessage(message: unknown): void; on(event: 'message', cb: (e: { data: any }) => void): void }
// Present when Electron starts this file as a utility process. The smoke test (scripts/smoke-router.mjs)
// starts it as a plain child process instead and talks over Node's own channel.
const parent = (process as unknown as { parentPort?: ParentPort }).parentPort
const tell = (message: Record<string, unknown>): void => {
  if (parent) parent.postMessage(message)
  else if (process.send) process.send(message)
  // Keys never go to the log.
  else console.log(`[host] ${JSON.stringify({ ...message, unifiedKey: undefined, sessionToken: undefined })}`)
}
const onParentMessage = (cb: (message: { type?: string } | undefined) => void): void => {
  if (parent) parent.on('message', (e) => cb(e.data))
  else process.on('message', (m) => cb(m as { type?: string }))
}

/** Antivirus and company networks re-sign HTTPS with a certificate from the system store; trust it too. */
function trustSystemCertificates(): void {
  try {
    const t = tls as unknown as { getCACertificates?: (kind: string) => string[]; setDefaultCACertificates?: (certs: string[]) => void }
    if (typeof t.getCACertificates !== 'function' || typeof t.setDefaultCACertificates !== 'function') return
    const system = t.getCACertificates('system')
    if (system.length === 0) return
    t.setDefaultCACertificates([...new Set([...t.getCACertificates('default'), ...system])])
    console.log(`[tls] trusting ${system.length} certificate(s) from the system store`)
  } catch (err) {
    console.warn(`[tls] could not load the system certificate store: ${(err as Error)?.message ?? err}`)
  }
}

function tryListen(app: ReturnType<typeof createApp>, host: string, port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = app.listen(port, host)
    server.once('listening', () => resolve(server))
    server.once('error', () => resolve(null))
  })
}

async function listenWithScan(app: ReturnType<typeof createApp>, host: string, start: number, attempts = 50): Promise<{ server: Server; port: number }> {
  for (let port = start; port < start + attempts; port++) {
    const server = await tryListen(app, host, port)
    if (server) return { server, port }
  }
  throw new Error(`No free port found in ${start}-${start + attempts - 1}`)
}

async function main(): Promise<void> {
  const dbPath = process.env.BRACKETS_ROUTER_DB
  const clientDist = process.env.BRACKETS_ROUTER_CLIENT
  if (!dbPath) throw new Error('BRACKETS_ROUTER_DB is not set')
  const preferredPort = Number(process.env.BRACKETS_ROUTER_PORT) || 31517

  installLogRedaction()
  installProcessSafetyNet()
  if (clientDist) process.env.CLIENT_DIST = clientDist
  // No dashboard password exists (the account below is a hidden local one), so the server must not
  // ask for it again before showing a key. It only skips that for requests from this computer.
  process.env.FREEAPI_DESKTOP = '1'

  initDb(dbPath, { factory: nodeSqliteFactory })
  const expired = cleanupExpiredCooldowns()
  if (expired > 0) console.log(`[ratelimit] cleared ${expired} expired cooldown(s)`)
  restoreProxySettings()
  trustSystemCertificates()
  loadCacheFromDb()

  const app = createApp()
  // Local only: nothing outside this computer can reach the router.
  const { server, port } = await listenWithScan(app, '127.0.0.1', preferredPort)

  const scheduler = new NodeScheduler()
  startHealthChecker(scheduler)
  startCatalogSync(scheduler)
  startCooldownProbe(scheduler)
  startModelProbe(scheduler)
  startBackupScheduler(scheduler)
  startCustomModelSync(getDb(), scheduler)
  startBuiltinModelDiscovery(getDb(), scheduler)
  startWakeDetect({
    async onWake(event: { idleMs: number; reason: string }) {
      console.log(`[wake] resumed after ~${Math.round(event.idleMs / 1000)}s (${event.reason}); flushing stale sockets, re-probing keys`)
      flushProxyCache()
      try {
        await checkAllKeys({ force: true })
      } catch (err: any) {
        console.error(`[wake] key re-probe failed: ${err?.message ?? err}`)
      }
    }
  })

  const close = (): void => {
    try {
      server.close()
      getDb().close?.()
    } catch {
      /* closing anyway */
    }
    process.exit(0)
  }
  onParentMessage((message) => {
    if (message?.type === 'stop') close()
    // A dashboard session lasts 30 days; the app asks for a fresh one when the old one is refused.
    if (message?.type === 'session') tell({ type: 'session', sessionToken: desktopSessionToken() })
  })
  process.on('SIGTERM', close)
  process.on('SIGINT', close)

  tell({ type: 'ready', port, unifiedKey: getUnifiedApiKey(), sessionToken: desktopSessionToken() })
}

main().catch((err) => {
  console.error(`[host] failed to start: ${err?.stack ?? err}`)
  tell({ type: 'failed', error: String(err?.message ?? err) })
  process.exit(1)
})
