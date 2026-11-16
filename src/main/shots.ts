// For checking the interface, and for making the pictures in the README, without clicking through
// it: start the app with BRACKETS_SHOTS set to a folder and it saves pictures there, then quits.
//
//   BRACKETS_SHOTS=shots            the folder for the pictures
//   BRACKETS_SHOTS_RUN=40           start answering first and let it run this many seconds
//   BRACKETS_SHOTS_VIEWS=monitor    only these pages (comma-separated); default: all of them
//   BRACKETS_SHOTS_DASHBOARD=1      also open the FreeLLMAPI dashboard and save a picture of it
//   BRACKETS_SHOTS_TOUR=1           with --demo: the full set for the README
//   BRACKETS_SHOTS_FRAMES=14        with --demo: this many seconds of frames, ten a second, into
//                                   <folder>/frames, for scripts/make-preview.mjs to turn into a GIF
//
// Without --demo, point BRACKETS_DATA at a throwaway profile so real settings are not touched.
import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const ALL = ['monitor', 'style', 'behavior', 'account', 'engine', 'settings']

export interface ShotHooks {
  start: () => Promise<void>
  state: () => unknown
  dashboard: () => Promise<BrowserWindow | null>
  /** Demo only: show the sign-in code screen, or the signed-in one. */
  authStage?: (stage: 'in' | 'device') => void
  /** Demo only: the line the scripted model has three answers for. */
  tryLine?: string
  done: () => void
}

export async function takeShots(win: BrowserWindow, hooks: ShotHooks): Promise<void> {
  const dir = path.resolve(process.env.BRACKETS_SHOTS ?? 'shots')
  const run = Number(process.env.BRACKETS_SHOTS_RUN) || 0
  const frames = Number(process.env.BRACKETS_SHOTS_FRAMES) || 0
  const tour = Boolean(process.env.BRACKETS_SHOTS_TOUR)
  const views = (process.env.BRACKETS_SHOTS_VIEWS ?? ALL.join(',')).split(',').map((v) => v.trim()).filter((v) => ALL.includes(v))
  mkdirSync(dir, { recursive: true })
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  const go = async (view: string, wait = 900): Promise<void> => {
    await js(`location.hash = '#${view}'`)
    await sleep(wait)
  }
  const shot = async (name: string): Promise<void> => {
    const image = await win.webContents.capturePage()
    writeFileSync(path.join(dir, `${name}.png`), image.toPNG())
  }
  const set = (patch: object): Promise<unknown> => js(`window.brackets.settings.set(${JSON.stringify(patch)})`)

  try {
    if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    win.show()
    await sleep(1500)

    if (frames > 0) {
      // A short film of the monitor at work: the chat running, one reply written and sent.
      mkdirSync(path.join(dir, 'frames'), { recursive: true })
      await go('monitor', 300)
      await hooks.start()
      await sleep(1200)
      const began = Date.now()
      for (let i = 0; i < frames * 10; i++) {
        const image = await win.webContents.capturePage()
        writeFileSync(path.join(dir, 'frames', `f${String(i).padStart(4, '0')}.png`), image.toPNG())
        // Hold a steady ten frames a second whatever a capture costs.
        await sleep(Math.max(0, began + (i + 1) * 100 - Date.now()))
      }
    } else if (tour) {
      await go('monitor', 300)
      await shot('start')
      await hooks.start()
      // By now the model has chosen a message and answered it, and the answer to a mention is being typed.
      await sleep(17000)
      await shot('monitor')
      await js(`document.querySelectorAll('aside [role=radio]')[1]?.click()`)
      await sleep(500)
      await shot('decisions')
      await js(`document.querySelectorAll('aside [role=radio]')[0]?.click()`)

      await go('style')
      if (hooks.tryLine) {
        // Type into the "Try it" box the way React expects, then press the button.
        await js(`(() => { const i = document.querySelector('aside form input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(hooks.tryLine)}); i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('aside form button').click() })()`)
        await sleep(2600)
      }
      await shot('style')
      await go('behavior')
      await shot('behavior')
      hooks.authStage?.('device')
      await go('account')
      await shot('account')
      hooks.authStage?.('in')
      await go('engine', 1500)
      await shot('model')
      await go('settings')
      await shot('themes')

      for (const theme of ['graphite', 'neon', 'daylight']) {
        await set({ ui: { theme } })
        await go('monitor', 1300)
        await shot(`theme-${theme}`)
      }
      await set({ ui: { theme: 'brackets' } })
    } else {
      if (run > 0) {
        await go('monitor', 600)
        await shot('monitor-idle')
        await hooks.start()
        await sleep(run * 1000)
        // What was said and why, to read alongside the pictures.
        writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(hooks.state(), null, 2))
      }
      for (const view of views) {
        await go(view)
        await shot(view)
      }
    }

    if (process.env.BRACKETS_SHOTS_DASHBOARD) {
      const board = await hooks.dashboard()
      if (board) {
        // The dashboard is a large page that draws itself after loading.
        await sleep(6000)
        writeFileSync(path.join(dir, 'dashboard.png'), (await board.webContents.capturePage()).toPNG())
      }
    }
  } finally {
    hooks.done()
  }
}
