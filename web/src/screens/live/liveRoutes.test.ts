// LIVE's Routes and Fills sections and the footer strip (look spec 7.11; ANALYTICS_CATALOG LV1): one
// route per journal close row and the fills the book counted, every value the API's; a plumbing row is
// shown with its banner and never enters the footer's totals (the API's summary counts it apart).
import { describe, expect, it } from 'vitest'
import { LIVE } from '../../copy/live'
import { BANNER, ROUTES_BODY } from './liveFixtures'
import { fillRows, routeFooter, routeRows, sideTone } from './liveRoutes'

describe('routeRows', () => {
  it('lists one row per close row, newest first, with its status, side and quantities as sent', () => {
    const rows = routeRows(ROUTES_BODY)
    expect(rows.map((r) => r.date)).toEqual(['2026-10-02', '2026-10-01', '2026-09-30', '2026-09-28'])
    const sent = rows[3]!
    expect(sent).toMatchObject({ status: 'sent', side: 'BUY', filled: '6', target: '6', avgPx: '24851.25', closePx: '24851.00', decisionPx: '24850.25', slip: '1.0' })
    expect(rows[2]).toMatchObject({ status: 'refused', side: LIVE.none, reason: 'no sizing price' })
    expect(rows[1]).toMatchObject({ status: 'error', reason: 'reconciliation failed: MNQZ6.CME holds 5, expected 6' })
  })

  it('carries the plumbing banner on a plumbing row', () => {
    const plumbing = routeRows(ROUTES_BODY)[0]!
    expect(plumbing.plumbing).toBe(true)
    expect(plumbing.banner).toBe(BANNER)
    expect(routeRows(ROUTES_BODY)[3]!.banner).toBeNull()
  })
})

describe('fillRows', () => {
  it('lists the fills newest first with notional in USD at the MNQ point value', () => {
    const rows = fillRows(ROUTES_BODY)
    expect(rows.map((r) => r.date)).toEqual(['2026-10-02', '2026-09-28'])
    expect(rows[1]).toMatchObject({ side: 'BUY', qty: '6', price: '24851.25', notional: '298,215.00', plumbing: false })
    expect(rows[0]!.plumbing).toBe(true)
  })
})

describe('the footer strip', () => {
  it('shows the API totals over performance rows, and the plumbing rows counted apart', () => {
    const items = routeFooter(ROUTES_BODY)
    const byKey = Object.fromEntries(items.map((i) => [i.key, i.value]))
    expect(byKey).toMatchObject({
      routes: '3', sent: '1', blocked: '0', refused: '1', errors: '1', fills: '1', filled: '6 ct', notional: '298,215.00 USD',
      plumbing: '1 routes, 1 fills (not counted)',
    })
  })
})

describe('sideTone', () => {
  it('colours BUY up and SELL down, as text (look spec 7.11)', () => {
    expect(sideTone('BUY')).toBe('up')
    expect(sideTone('SELL')).toBe('down')
    expect(sideTone(null)).toBeUndefined()
  })
})
