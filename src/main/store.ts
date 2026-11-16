// Settings and secrets on disk. Settings are plain JSON; secrets (the Twitch tokens, a key for your
// own model server, the key that protects the router's database) are encrypted by the operating
// system for the current user before they are written.
import { app, safeStorage } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, defaultPersona, merge, sanitizeSettings } from '@shared/defaults'
import type { DeepPartial, Lang, Settings } from '@shared/types'

export type SecretName = 'twitch.access' | 'twitch.refresh' | 'llm.customKey' | 'router.key'

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

function readJson(file: string): unknown {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
  } catch {
    return undefined
  }
}

export class Store extends EventEmitter {
  private settings: Settings = sanitizeSettings(undefined)
  /** Secrets as they are on disk: "enc:" + base64 of the encrypted bytes. */
  private stored: Record<string, string> = {}
  /** The same secrets readable, kept in memory only. */
  private plain: Record<string, string> = {}
  private encrypts = false
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  /** Set when saving failed, so the window can say so. */
  saveError = ''

  get dir(): string {
    return app.getPath('userData')
  }
  private get settingsFile(): string {
    return path.join(this.dir, 'settings.json')
  }
  private get secretsFile(): string {
    return path.join(this.dir, 'secrets.json')
  }

  /** Read everything from disk. Call once, after the app is ready. */
  async load(): Promise<void> {
    const saved = readJson(this.settingsFile)
    this.settings = sanitizeSettings(saved)
    // A new profile starts with the manner written in the system's language.
    if (!saved || typeof saved !== 'object' || !('persona' in saved)) this.settings.persona = defaultPersona(this.lang())
    const raw = readJson(this.secretsFile)
    this.stored = raw && typeof raw === 'object' ? (raw as Record<string, string>) : {}
    try {
      this.encrypts = await safeStorage.isAsyncEncryptionAvailable()
    } catch {
      this.encrypts = false
    }
    for (const [name, value] of Object.entries(this.stored)) {
      try {
        if (value.startsWith('enc:')) {
          const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(value.slice(4), 'base64'))
          this.plain[name] = result
          // Windows rotated the key it encrypts with: store this one again under the new key.
          if (shouldReEncrypt) this.setSecret(name as SecretName, result)
        } else if (value.startsWith('raw:')) {
          // Written on a system that could not encrypt.
          this.plain[name] = Buffer.from(value.slice(4), 'base64').toString('utf8')
        }
      } catch {
        // Encrypted by another Windows account or on another computer: unreadable here.
      }
    }
  }

  get(): Settings {
    return this.settings
  }

  patch(patch: DeepPartial<Settings>): Settings {
    this.settings = sanitizeSettings(merge(this.settings, patch))
    this.scheduleSave()
    this.emit('changed', this.settings)
    return this.settings
  }

  /** The interface language: the chosen one, or the system's. */
  lang(): Lang {
    const set = this.settings.ui.lang
    return set === 'auto' ? (app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en') : set
  }

  reset(section: 'persona' | 'behavior' | 'llm'): Settings {
    const fresh = section === 'persona' ? defaultPersona(this.lang()) : structuredClone(DEFAULT_SETTINGS[section])
    return this.patch({ [section]: fresh } as DeepPartial<Settings>)
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 250)
  }

  /** Write settings now (also called before the app quits). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      writeAtomic(this.settingsFile, JSON.stringify(this.settings, null, 2))
      this.saveError = ''
    } catch (err) {
      this.saveError = String((err as Error)?.message ?? err)
    }
  }

  /** True when secrets are really encrypted on this system, not just encoded. */
  get canEncrypt(): boolean {
    return this.encrypts
  }

  secret(name: SecretName): string {
    return this.plain[name] ?? ''
  }

  /** Remember a secret ('' forgets it). It is readable at once; the file follows a moment later. */
  setSecret(name: SecretName, value: string): void {
    if (value) this.plain[name] = value
    else delete this.plain[name]
    // One write after another, so two changes in a row cannot land out of order.
    this.writing = this.writing.then(async () => {
      try {
        if (!value) delete this.stored[name]
        else if (this.encrypts) this.stored[name] = 'enc:' + (await safeStorage.encryptStringAsync(value)).toString('base64')
        else this.stored[name] = 'raw:' + Buffer.from(value, 'utf8').toString('base64')
        writeAtomic(this.secretsFile, JSON.stringify(this.stored, null, 2))
      } catch (err) {
        this.saveError = String((err as Error)?.message ?? err)
      }
    })
  }

  /** Resolves when every secret changed so far is on disk. */
  settle(): Promise<void> {
    return this.writing
  }
}

export const store = new Store()
