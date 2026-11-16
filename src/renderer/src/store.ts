import { useMemo } from 'react'
import { create } from 'zustand'
import { merge } from '@shared/defaults'
import type { AppInfo, AuthStatus, Beat, BotStatus, DecisionEntry, DeepPartial, FeedItem, Lang, ReplyItem, RouterStatus, Settings } from '@shared/types'
import { api } from './api'

export type View = 'monitor' | 'style' | 'behavior' | 'account' | 'engine' | 'settings'
export const VIEWS: View[] = ['monitor', 'style', 'behavior', 'account', 'engine', 'settings']

const FEED_MAX = 400
const REPLIES_MAX = 100
const DECISIONS_MAX = 120
const BEATS_MAX = 4000

/**
 * The marks on the rhythm strip. Kept outside the store on purpose: the strip is a canvas that
 * redraws on its own clock, and a busy chat would otherwise re-render the page for every message.
 */
export const beats: Beat[] = []

interface State {
  ready: boolean
  settings: Settings | null
  auth: AuthStatus | null
  router: RouterStatus | null
  info: AppInfo | null
  status: BotStatus | null
  feed: FeedItem[]
  replies: ReplyItem[]
  decisions: DecisionEntry[]
  view: View
  setView(v: View): void
  patch(p: DeepPartial<Settings>): void
  init(): Promise<void>
}

const viewFromHash = (): View => {
  const v = window.location.hash.replace(/^#\/?/, '') as View
  return VIEWS.includes(v) ? v : 'monitor'
}

// Settings changes go to the main process and come back cleaned up. Typing sends one change per
// keystroke; an answer to an older one must not overwrite what was typed since.
let seq = 0
let inFlight = 0
let started = false

export const useApp = create<State>((set, get) => ({
  ready: false,
  settings: null,
  auth: null,
  router: null,
  info: null,
  status: null,
  feed: [],
  replies: [],
  decisions: [],
  view: viewFromHash(),

  setView(v) {
    if (window.location.hash !== `#${v}`) window.location.hash = v
    set({ view: v })
  },

  patch(p) {
    const current = get().settings
    if (!current) return
    const mine = ++seq
    inFlight++
    set({ settings: merge(current, p) })
    api.settings
      .set(p)
      .then((saved) => {
        if (mine === seq) set({ settings: saved })
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight--
      })
  },

  async init() {
    // React's strict mode runs effects twice in development; listeners must be attached once.
    if (started) return
    started = true
    const [settings, auth, router, info, snap] = await Promise.all([api.settings.get(), api.auth.status(), api.router.status(), api.app.info(), api.bot.snapshot()])
    beats.length = 0
    beats.push(...snap.beats)
    set({ ready: true, settings, auth, router, info, status: snap.status, feed: snap.feed, replies: snap.replies, decisions: snap.decisions })

    api.settings.onChanged((s) => {
      // While the window's own change is on its way, its answer will carry the newest state.
      if (inFlight === 0) set({ settings: s })
    })
    api.auth.onChanged((a) => set({ auth: a }))
    api.router.onStatus((r) => set({ router: r }))
    api.bot.onEvents((batch) => {
      const st = get()
      let feed = st.feed
      let replies = st.replies
      let decisions = st.decisions
      let status = st.status
      for (const ev of batch) {
        if (ev.e === 'status') status = ev.s
        else if (ev.e === 'beat') {
          beats.push(ev.b)
          if (beats.length > BEATS_MAX) beats.splice(0, beats.length - BEATS_MAX)
        } else if (ev.e === 'feed') {
          if (feed === st.feed) feed = feed.slice()
          const at = feed.findIndex((f) => f.id === ev.item.id)
          if (at >= 0) feed[at] = ev.item
          else feed.push(ev.item)
          if (ev.item.type === 'reply') {
            const id = ev.item.id
            if (replies === st.replies) replies = replies.slice()
            const r = replies.findIndex((x) => x.id === id)
            if (r >= 0) replies[r] = ev.item
            else replies.push(ev.item)
          }
        } else if (ev.e === 'pick') {
          const at = feed.findIndex((f) => f.id === ev.id)
          const item = feed[at]
          if (item && item.type === 'msg') {
            if (feed === st.feed) feed = feed.slice()
            feed[at] = { ...item, picked: true }
          }
        } else if (ev.e === 'decision') {
          if (decisions === st.decisions) decisions = decisions.slice()
          decisions.push(ev.d)
        }
      }
      if (feed.length > FEED_MAX) feed = feed.slice(feed.length - FEED_MAX)
      if (replies.length > REPLIES_MAX) replies = replies.slice(replies.length - REPLIES_MAX)
      if (decisions.length > DECISIONS_MAX) decisions = decisions.slice(decisions.length - DECISIONS_MAX)
      set({ feed, replies, decisions, status })
    })
    window.addEventListener('hashchange', () => set({ view: viewFromHash() }))
  }
}))

/** The interface language: the chosen one, or the system's. */
export function useLang(): Lang {
  const set = useApp((s) => s.settings?.ui.lang ?? 'auto')
  const locale = useApp((s) => s.info?.locale ?? navigator.language)
  return set === 'auto' ? (locale.toLowerCase().startsWith('ru') ? 'ru' : 'en') : set
}

/** Every piece of interface text is written in both languages where it is used: l('Старт', 'Start'). */
export function useL(): (ru: string, en: string) => string {
  const lang = useLang()
  // The same function until the language changes, so rows that take it do not redraw for nothing.
  return useMemo(() => (ru: string, en: string) => (lang === 'ru' ? ru : en), [lang])
}
