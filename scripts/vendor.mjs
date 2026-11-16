// Fetches FreeLLMAPI (https://github.com/tashfeenahmed/freellmapi, MIT) at a pinned commit into
// vendor/freellmapi, installs its dependencies and builds its dashboard. Run once: npm run vendor.
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO, TAG, COMMIT } from './vendor.config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'vendor', 'freellmapi')

const git = (args, cwd = dir) => {
  console.log(`\n> git ${args.join(' ')}`)
  execFileSync('git', args, { cwd, stdio: 'inherit' })
}
// npm is a .cmd file on Windows, which only a shell can start; these command lines are fixed text.
const npm = (line) => {
  console.log(`\n> npm ${line}`)
  execSync(`npm ${line}`, { cwd: dir, stdio: 'inherit' })
}
const head = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

if (existsSync(dir) && head() !== COMMIT) {
  console.log(`vendor/freellmapi is not at ${TAG}; fetching it again`)
  rmSync(dir, { recursive: true, force: true })
}
if (!existsSync(dir)) {
  mkdirSync(path.dirname(dir), { recursive: true })
  git(['-c', 'advice.detachedHead=false', 'clone', '--depth', '1', '--branch', TAG, REPO, dir], root)
}
if (head() !== COMMIT) {
  console.error(`\nFreeLLMAPI ${TAG} is at ${head() || 'an unknown commit'}, expected ${COMMIT}.\nThe tag was moved. Read the changes before trusting it, then update scripts/vendor.config.mjs.`)
  process.exit(1)
}

// Install scripts stay off: nothing the router bundle needs is built by one. Its database runs on
// Node's own SQLite (node:sqlite), so better-sqlite3 is never compiled.
if (!existsSync(path.join(dir, 'node_modules', 'express'))) npm('install --no-audit --no-fund --ignore-scripts')
if (!existsSync(path.join(dir, 'client', 'dist', 'index.html'))) npm('exec --workspace client -- vite build')

console.log(`\nFreeLLMAPI ${TAG} is ready in vendor/freellmapi`)
