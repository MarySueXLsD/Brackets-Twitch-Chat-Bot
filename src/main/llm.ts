// One chat request to an OpenAI-compatible server: the built-in FreeLLMAPI router, or any other.

export interface ChatArgs {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  user: string
  temperature: number
  maxTokens: number
  timeoutMs: number
}

export interface ChatResult {
  text: string
  /** Which provider and model answered, as "provider/model" when the server says. */
  via: string
  ms: number
}

export class LlmError extends Error {
  status: number
  code: string
  constructor(message: string, status = 0, code = '') {
    super(message)
    this.name = 'LlmError'
    this.status = status
    this.code = code
  }
}

function contentOf(message: any): string {
  const c = message?.content
  if (typeof c === 'string') return c
  // Some servers answer with a list of parts.
  if (Array.isArray(c)) return c.map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')).join('')
  return ''
}

export async function chat(a: ChatArgs): Promise<ChatResult> {
  const started = Date.now()
  const url = a.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(a.apiKey ? { Authorization: `Bearer ${a.apiKey}` } : {}) },
      body: JSON.stringify({
        model: a.model,
        messages: [
          { role: 'system', content: a.system },
          { role: 'user', content: a.user }
        ],
        temperature: a.temperature,
        max_tokens: a.maxTokens,
        stream: false
      }),
      signal: AbortSignal.timeout(a.timeoutMs)
    })
  } catch (err) {
    const e = err as Error
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new LlmError('The model took too long to answer', 0, 'timeout')
    throw new LlmError(`The model server cannot be reached (${e.message})`, 0, 'unreachable')
  }
  const text = await res.text()
  let body: any = null
  try {
    body = JSON.parse(text)
  } catch {
    /* not JSON: handled below */
  }
  if (!res.ok) {
    const message = body?.error?.message ?? body?.message ?? text.slice(0, 300)
    throw new LlmError(String(message || `HTTP ${res.status}`), res.status, String(body?.error?.code ?? body?.error?.type ?? ''))
  }
  const choice = body?.choices?.[0]
  const via = res.headers.get('x-routed-via') || [body?.provider, body?.model].filter(Boolean).join('/') || a.model
  return { text: contentOf(choice?.message), via, ms: Date.now() - started }
}

/** The model names a server offers, for the picker. Empty when it will not say. */
export async function listModels(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, '') + '/models', { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const body = (await res.json()) as any
    return (Array.isArray(body?.data) ? body.data : []).map((m: any) => String(m?.id ?? '')).filter(Boolean)
  } catch {
    return []
  }
}
