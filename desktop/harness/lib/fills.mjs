// Port of bench_browser.fills_body: 8,411 synthetic fills in the repository's shape, answered by the harness.
export const FILLS = 8411
const ROOTS = ['ES', 'NQ', 'YM', 'ZT', 'ZF', 'ZN', 'ZB', '6E', '6J', '6B', '6A', '6C', '6S', 'CL', 'NG', 'HO', 'RB', 'GC', 'SI', 'HG', 'ZC', 'ZS', 'ZW', 'ZL', 'ZM', 'LE', 'HE']
const FIRST = Date.UTC(2012, 0, 4) / 1000

export function fillsBody(url) {
  const q = new URL(url).searchParams
  const offset = Number(q.get('offset') ?? 0)
  const limit = Number(q.get('limit') ?? 500)
  const items = []
  for (let i = offset; i < Math.min(offset + limit, FILLS); i++) {
    const root = ROOTS[i % ROOTS.length]
    const day = FIRST + Math.floor(i / ROOTS.length) * 86400 * 7
    const qty = 1 + ((i * 37) % 180)
    items.push({
      ts: new Date(day * 1000).toISOString().slice(0, 19) + '.000000000Z', ts_epoch_s: day, instrument: `${root}.XCME`,
      side: i % 3 === 0 ? 'SELL' : 'BUY', qty, px: Math.round((100 + ((i * 7919) % 400000) / 100) * 100) / 100,
      commission: (qty * 7.5).toFixed(4), commission_float: qty * 7.5, position_id: `DtsMom-${String(Math.floor(i / 54)).padStart(3, '0')}-${root}-L1`,
      order_id: `O-${i}`, tags: i % 5 === 0 ? 'ROLL' : 'REBAL',
    })
  }
  return JSON.stringify({ items, offset, limit, total: FILLS })
}
