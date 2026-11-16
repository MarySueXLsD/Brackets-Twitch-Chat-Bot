import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { APP_NAME } from '@shared/defaults'
import type { BotEvent } from '@shared/types'
import { Bot } from './bot'
import { createDemo } from './demo'
import { registerIpc } from './ipc'
import { router } from './router'
import { takeShots } from './shots'
import { store } from './store'
import { Auth } from './twitch/auth'
import { TwitchChat } from './twitch/chat'

// `--demo` (or `--demo=ru`) shows the app on a made-up chat: no Twitch, no account, no model.
const demoArg = process.argv.find((a) => a === '--demo' || a.startsWith('--demo='))
const demo = demoArg ? createDemo(demoArg === '--demo=ru' ? 'ru' : 'en') : null

// Settings live in their own folder. Not plain "Brackets": the code editor of that name keeps its
// files in %APPDATA%\Brackets. The demo gets a folder of its own, so it cannot touch real settings.
// A throwaway profile for trying things out: BRACKETS_DATA=some\folder.
app.setPath('userData', process.env.BRACKETS_DATA ? path.resolve(process.env.BRACKETS_DATA) : path.join(app.getPath('appData'), demo ? 'Brackets Twitch Chat Bot (demo)' : 'Brackets Twitch Chat Bot'))

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let running = false

const realAuth = demo ? null : new Auth(store)
const auth = demo ? demo.auth : realAuth!
const bot = demo ? new Bot(store, demo.auth, router, demo.chat, { model: demo.model, demo: demo.scene }) : new Bot(store, realAuth!, router, new TwitchChat())

const resource = (name: string): string => (app.isPackaged ? path.join(process.resourcesPath, name) : path.join(app.getAppPath(), 'resources', name))

const l = (ru: string, en: string): string => (store.lang() === 'ru' ? ru : en)

function showWindow(): void {
  if (!win || win.isDestroyed()) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(hidden = false): void {
  const icon = resource('icon.png')
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 1040,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: '#15131f',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: { color: '#15131f', symbolColor: '#a9a5c0', height: 40 } }),
    ...(existsSync(icon) ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The window shows a live chat; it must keep up while another program is in front.
      backgroundThrottling: false
    }
  })
  const w = win
  w.once('ready-to-show', () => {
    if (!hidden) w.show()
  })
  w.on('close', (e) => {
    // Closing the window leaves the responder working in the tray, unless that is switched off.
    if (!quitting && store.get().ui.closeToTray && tray) {
      e.preventDefault()
      w.hide()
    }
  })
  w.on('closed', () => {
    if (win === w) win = null
  })
  // Nothing in the window navigates anywhere; a link that tries opens in the browser instead.
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

function trayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: l(`Открыть ${APP_NAME}`, `Open ${APP_NAME}`), click: showWindow },
    { type: 'separator' },
    running ? { label: l('Остановить ответы', 'Stop answering'), click: () => bot.stop() } : { label: l('Начать отвечать', 'Start answering'), click: () => void bot.start() },
    { type: 'separator' },
    { label: l('Выйти', 'Quit'), click: quit }
  ])
}

function refreshTray(): void {
  if (!tray) return
  tray.setContextMenu(trayMenu())
  tray.setToolTip(running ? l(`${APP_NAME}: отвечает в чате`, `${APP_NAME}: answering in chat`) : l(`${APP_NAME}: остановлен`, `${APP_NAME}: stopped`))
}

function createTray(): void {
  const file = resource('tray.png')
  const image = existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty()
  if (image.isEmpty()) return
  tray = new Tray(image)
  tray.on('click', showWindow)
  refreshTray()
}

function applyStartup(): void {
  // Meaningless for a development run: it would register the bare Electron binary.
  if (!app.isPackaged) return
  const ui = store.get().ui
  app.setLoginItemSettings({ openAtLogin: ui.launchAtLogin, args: ui.startHidden ? ['--hidden'] : [] })
}

function quit(): void {
  quitting = true
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('activate', showWindow)
  if (process.platform === 'win32') app.setAppUserModelId('app.brackets.twitchbot')

  app.whenReady().then(async () => {
    await store.load()
    if (demo) {
      store.patch(demo.settings)
      demo.attach(bot)
    }
    Menu.setApplicationMenu(null)
    router.registerDashboardBridge()
    router.encryptionKey = () => {
      // Without real encryption for the key itself, leave the router to its own key file.
      if (!store.canEncrypt) return ''
      let key = store.secret('router.key')
      if (!key) {
        key = randomBytes(32).toString('hex')
        store.setSecret('router.key', key)
      }
      return key
    }
    registerIpc({ store, auth, router, bot, window: () => win, applyStartup, quit })

    bot.on('events', (batch: BotEvent[]) => {
      for (const ev of batch) {
        if (ev.e !== 'status') continue
        const now = ev.s.state === 'running' || ev.s.state === 'starting'
        if (now !== running) {
          running = now
          refreshTray()
        }
      }
    })
    store.on('changed', refreshTray)

    createTray()
    const hidden = (process.argv.includes('--hidden') || store.get().ui.startHidden) && tray !== null
    createWindow(hidden)
    applyStartup()
    realAuth?.startKeeping()
    // Warm the model router up in the background so the first reply does not wait for it.
    // (The demo does not need it, so a checkout without the router built stays quiet about that.)
    if (store.get().llm.source === 'builtin' && (!demo || router.built)) void router.start()
    if (process.env.BRACKETS_SHOTS && win) {
      void takeShots(win, { start: () => bot.start(), state: () => bot.snapshot(), dashboard: () => router.openDashboard(), done: quit, ...(demo ? { authStage: (stage) => demo.auth.setStage(stage), tryLine: demo.tryLine } : {}) })
    }
    else if (store.get().ui.autoStart) void bot.start()
  })

  app.on('window-all-closed', () => {
    // With the tray icon the app lives on without a window.
    if (!tray || !store.get().ui.closeToTray) quit()
  })

  let cleaned = false
  app.on('before-quit', (e) => {
    quitting = true
    if (cleaned) return
    // Let the router close its database before the process goes.
    e.preventDefault()
    cleaned = true
    bot.stop()
    store.flush()
    void Promise.allSettled([router.stop(), store.settle()]).finally(() => app.quit())
  })
}
