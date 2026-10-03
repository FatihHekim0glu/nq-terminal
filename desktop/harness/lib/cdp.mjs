// Minimal CDP client over Node's built-in WebSocket (no dependencies), with the interception of the T2 harness
// (Fetch.requestPaused answered from a body generator) generalised to both stages, so a request can be answered
// instead of sent (the synthetic fills) or its real response rewritten (the 20,000-bar series).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function listTargets(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })
    return await r.json()
  } catch { return [] }
}

export async function browserVersion(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
    return await r.json()
  } catch { return null }
}

const dropHeaders = new Set(['content-length', 'content-encoding', 'transfer-encoding'])

export class Cdp {
  constructor(wsUrl) { this.id = 0; this.pending = new Map(); this.events = []; this.listeners = new Map(); this.rules = []; this.ws = new WebSocket(wsUrl) }

  open() {
    return new Promise((res, rej) => {
      this.ws.onopen = res
      this.ws.onerror = () => rej(new Error('websocket error'))
      this.ws.onmessage = (ev) => this.#onMessage(JSON.parse(ev.data))
    })
  }

  on(method, fn) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]) }

  #onMessage(m) {
    if (m.id && this.pending.has(m.id)) {
      const p = this.pending.get(m.id); this.pending.delete(m.id)
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)
      return
    }
    if (m.method === 'Fetch.requestPaused') { this.#onPaused(m.params).catch(() => {}); return }
    if (m.method) {
      this.events.push(m)
      for (const fn of this.listeners.get(m.method) ?? []) fn(m.params)
    }
  }

  async #onPaused(p) {
    const stage = p.responseStatusCode === undefined ? 'Request' : 'Response'
    const rule = this.rules.find((r) => r.stage === stage && p.request.url.includes(r.match))
    const answer = rule ? await rule.handle(p, this).catch(() => null) : null
    if (!answer) {
      if (stage === 'Response') return this.send('Fetch.continueResponse', { requestId: p.requestId })
      return this.send('Fetch.continueRequest', { requestId: p.requestId })
    }
    const headers = (p.responseHeaders ?? []).filter((h) => !dropHeaders.has(h.name.toLowerCase()) && h.name.toLowerCase() !== 'content-type')
    headers.push({ name: 'Content-Type', value: answer.contentType ?? 'application/json' })
    return this.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: answer.status ?? p.responseStatusCode ?? 200, responseHeaders: headers, body: Buffer.from(answer.body).toString('base64') })
  }

  /** match: substring of the URL; stage 'Request' (answer instead of send) or 'Response' (rewrite the real body); handle(params, cdp) -> { body } | null. */
  addRule(match, stage, handle) { this.rules.push({ match, stage, handle }) }

  async enableRules() {
    if (this.rules.length === 0) return
    await this.send('Fetch.enable', { patterns: this.rules.map((r) => ({ urlPattern: `*${r.match}*`, requestStage: r.stage })) })
  }

  async disableRules() { this.rules = []; await this.send('Fetch.disable').catch(() => {}) }

  send(method, params = {}, timeoutMs = 60_000) {
    const id = ++this.id
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`timeout waiting for ${method}`)) }, timeoutMs)
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v) }, rej: (e) => { clearTimeout(t); rej(e) } })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expr, { awaitPromise = false, timeoutMs = 60_000 } = {}) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, timeoutMs)
    if (r.exceptionDetails) throw new Error('js: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
    return r.result.value
  }

  async waitFor(expr, ms, step = 20) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      try { if (await this.eval(expr)) return true } catch { /* page navigating */ }
      await sleep(step)
    }
    return false
  }

  async key(key, code, vk, { modifiers = 0, text = null } = {}) {
    const base = { modifiers, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }
    if (text !== null) await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyDown', text, unmodifiedText: text })
    else await this.send('Input.dispatchKeyEvent', { ...base, type: 'rawKeyDown' })
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
  }

  close() { try { this.ws.close() } catch { /* ignore */ } }
}

/** Finds a page target whose URL starts with `urlPrefix` (or any page target when the prefix is null). */
export async function findPage(port, urlPrefix, ms, step = 20) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const page = (await listTargets(port)).find((t) => t.type === 'page' && (urlPrefix === null || t.url.startsWith(urlPrefix)))
    if (page) return page
    await sleep(step)
  }
  return null
}

export async function attach(port, urlPrefix, ms) {
  const page = await findPage(port, urlPrefix, ms)
  if (!page) return null
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  return { cdp, page }
}
