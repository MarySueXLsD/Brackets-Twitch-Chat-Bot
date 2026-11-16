import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve(__dirname, 'src/shared'), '@core': resolve(__dirname, 'src/core') }

// The Client ID of your own Twitch application, built into the app so nobody has to type it:
// one line in twitch-client-id.local.txt (not committed), or the BRACKETS_TWITCH_CLIENT_ID variable.
// Without either, the Account page asks for it. A Client ID is not a secret.
const file = resolve(__dirname, 'twitch-client-id.local.txt')
const clientId = (process.env.BRACKETS_TWITCH_CLIENT_ID ?? (existsSync(file) ? readFileSync(file, 'utf8') : '')).trim()
if (clientId && !/^[a-z0-9]{20,40}$/i.test(clientId)) throw new Error('twitch-client-id.local.txt does not hold a Twitch Client ID')
const define = { __TWITCH_CLIENT_ID__: JSON.stringify(clientId) }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    define,
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // The FreeLLMAPI dashboard window gets its own, much smaller bridge.
          dashboard: resolve(__dirname, 'src/preload/dashboard.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    define,
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
})
