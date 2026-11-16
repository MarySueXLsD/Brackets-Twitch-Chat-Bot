// Every call the window can make, and every event it can listen to. The preload script builds the
// bridge from this list and src/main/ipc.ts answers it; names starting with "on" are events.
export const API_CHANNELS = {
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    reset: 'settings:reset',
    onChanged: 'settings:changed'
  },
  bot: {
    start: 'bot:start',
    stop: 'bot:stop',
    snapshot: 'bot:snapshot',
    replyNow: 'bot:reply-now',
    resume: 'bot:resume',
    clearFeed: 'bot:clear-feed',
    onEvents: 'bot:events'
  },
  auth: {
    status: 'auth:status',
    startDevice: 'auth:start-device',
    cancelDevice: 'auth:cancel-device',
    setToken: 'auth:set-token',
    signOut: 'auth:sign-out',
    onChanged: 'auth:changed'
  },
  router: {
    status: 'router:status',
    restart: 'router:restart',
    providers: 'router:providers',
    keys: 'router:keys',
    addKey: 'router:add-key',
    removeKey: 'router:remove-key',
    models: 'router:models',
    logs: 'router:logs',
    openDashboard: 'router:open-dashboard',
    onStatus: 'router:on-status'
  },
  llm: {
    sample: 'llm:sample',
    prompt: 'llm:prompt',
    setCustomKey: 'llm:set-custom-key',
    hasCustomKey: 'llm:has-custom-key'
  },
  app: {
    info: 'app:info',
    openExternal: 'app:open-external',
    openDataDir: 'app:open-data-dir',
    chrome: 'app:chrome',
    quit: 'app:quit'
  }
} as const

/** Web addresses the window may ask the system browser to open. Nothing else leaves the app. */
export const ALLOWED_LINKS = [
  'https://www.twitch.tv/',
  'https://twitch.tv/',
  'https://dev.twitch.tv/',
  'https://id.twitch.tv/',
  'https://github.com/tashfeenahmed/freellmapi',
  'https://freellmapi.co/',
  'https://console.groq.com/',
  'https://aistudio.google.com/',
  'https://cloud.cerebras.ai/',
  'https://openrouter.ai/',
  'https://console.mistral.ai/',
  'https://build.nvidia.com/',
  'https://github.com/MarySueXLsD',
  'https://marysue.itch.io'
]
