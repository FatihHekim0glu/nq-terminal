// The 20,000-bar series of the GIP pan and zoom row (03 section 18). One intraday session holds a few hundred to about
// 1,400 one-minute bars, so the harness answers the page's own /api/bars request with the real series tiled out to
// 20,000 bars (the same idea as the synthetic 8,411 fills): the shape is the API's (`Bars`, columns t o h l c v), the
// timestamps keep running forward and every other field is the real response's. The record says the series is synthetic.
export const BARS_TARGET = 20_000

const COLUMNS = ['t', 'o', 'h', 'l', 'c', 'v']

/** Median positive step between consecutive timestamps (the bar width), or 60 when there is no step to read. */
export function stepOf(t) {
  const d = []
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) d.push(t[i] - t[i - 1])
  d.sort((a, b) => a - b)
  return d.length ? d[Math.floor(d.length / 2)] : 60
}

/** The body tiled out to `n` bars; a body that is not a bar series, or already has `n` or more, comes back as null. */
export function extendBars(body, n = BARS_TARGET) {
  if (!body || !Array.isArray(body.t) || body.t.length === 0 || body.t.length >= n) return null
  if (!COLUMNS.every((c) => Array.isArray(body[c]) && body[c].length === body.t.length)) return null
  const m = body.t.length
  const period = body.t[m - 1] - body.t[0] + stepOf(body.t)
  const out = { ...body }
  for (const c of COLUMNS) out[c] = new Array(n)
  for (let k = 0; k < n; k++) {
    const i = k % m
    const lap = Math.floor(k / m)
    for (const c of COLUMNS) out[c][k] = c === 't' ? body.t[i] + lap * period : body[c][i]
  }
  if (typeof body.end === 'string') out.end = body.end
  return out
}

/** A Fetch response-stage handler for CDP: tiles an intraday /api/bars response to `n` bars, counting what it rewrote. */
export function barsRule(n = BARS_TARGET, seen = { rewritten: 0, baseBars: null }) {
  const handle = async (params, cdp) => {
    if (!/[?&]timeframe=1m\b/.test(params.request.url)) return null
    const got = await cdp.send('Fetch.getResponseBody', { requestId: params.requestId })
    const text = got.base64Encoded ? Buffer.from(got.body, 'base64').toString('utf8') : got.body
    const extended = extendBars(JSON.parse(text), n)
    if (!extended) return null
    seen.rewritten += 1
    seen.baseBars ??= JSON.parse(text).t.length
    return { body: JSON.stringify(extended) }
  }
  return { match: '/api/bars', stage: 'Response', handle, seen }
}
