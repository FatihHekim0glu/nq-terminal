// The IB snapshot model: which of the states the panel is in, how old the data is, the masked accounts and the
// formatted rows. Born-failing cases first: a snapshot that cannot be proved fresh is never live, and an account id
// that is not masked is masked again here, whatever the server sent.
import { describe, expect, it } from 'vitest'
import {
  STALE_AFTER_MS,
  accountItems,
  executionRows,
  formatAge,
  formatUtcTime,
  ibViewState,
  maskAccount,
  maskAccounts,
  netLiquidation,
  positionRows,
  readIbSnapshot,
  snapshotAgeMs,
  workingRows,
} from './ibSnapshotModel'
import {
  DISABLED_SNAPSHOT,
  EMPTY_SNAPSHOT,
  FETCHED_MS,
  LIVE_SNAPSHOT,
  NOW_FRESH_MS,
  NOW_STALE_MS,
  REFUSED_SNAPSHOT,
  UNAVAILABLE_SNAPSHOT,
} from './ibSnapshot.fixtures'

describe('ibViewState', () => {
  it('is loading until a body or a failure arrives', () => {
    expect(ibViewState(null, false, NOW_FRESH_MS)).toBe('loading')
  })

  it('is error when the read failed and there is no body to show', () => {
    expect(ibViewState(null, true, NOW_FRESH_MS)).toBe('error')
  })

  it("is the server's own state for disabled, unavailable and refused, however the clock reads", () => {
    expect(ibViewState(DISABLED_SNAPSHOT, false, NOW_FRESH_MS)).toBe('disabled')
    expect(ibViewState(UNAVAILABLE_SNAPSHOT, false, NOW_STALE_MS)).toBe('unavailable')
    expect(ibViewState(REFUSED_SNAPSHOT, false, NOW_FRESH_MS)).toBe('refused')
  })

  it('is live for an ok body read a few seconds ago', () => {
    expect(ibViewState(LIVE_SNAPSHOT, false, NOW_FRESH_MS)).toBe('live')
  })

  it('is stale once the body is older than the limit', () => {
    expect(ibViewState(LIVE_SNAPSHOT, false, NOW_STALE_MS)).toBe('stale')
    expect(ibViewState(LIVE_SNAPSHOT, false, FETCHED_MS + STALE_AFTER_MS)).toBe('live')
    expect(ibViewState(LIVE_SNAPSHOT, false, FETCHED_MS + STALE_AFTER_MS + 1)).toBe('stale')
  })

  it('is never live without a time to prove it fresh', () => {
    expect(ibViewState({ ...LIVE_SNAPSHOT, fetched_at_utc: null }, false, NOW_FRESH_MS)).toBe('stale')
    expect(ibViewState({ ...LIVE_SNAPSHOT, fetched_at_utc: 'not a time' }, false, NOW_FRESH_MS)).toBe('stale')
  })

  it('a time in the future (clock skew) is not live either', () => {
    expect(ibViewState(LIVE_SNAPSHOT, false, FETCHED_MS - 60_000)).toBe('stale')
  })

  it('keeps the last body on screen as stale when a later read failed', () => {
    expect(ibViewState(LIVE_SNAPSHOT, true, NOW_FRESH_MS)).toBe('stale')
  })
})

describe('freshness judged from the browser receipt time (no clock skew, no lag)', () => {
  const RECEIVED = FETCHED_MS + 60_000 // the browser's own clock: the server's clock is 60 s behind it
  const cached = (age_s: number) => ({ ...LIVE_SNAPSHOT, cached: true, age_s })

  it('a body just received is live even when its read time is after the browser clock', () => {
    const ahead = { ...LIVE_SNAPSHOT, fetched_at_utc: new Date(RECEIVED + 90_000).toISOString() }
    expect(ibViewState(ahead, false, RECEIVED, RECEIVED)).toBe('live')
    expect(snapshotAgeMs(ahead, RECEIVED, RECEIVED)).toBe(0)
  })

  it('a body just received is live even when the browser clock is far from the server clock', () => {
    expect(ibViewState(LIVE_SNAPSHOT, false, RECEIVED, RECEIVED)).toBe('live')
  })

  it('a clock that lags the receipt by a few seconds still reads age 0, never negative', () => {
    expect(snapshotAgeMs(LIVE_SNAPSHOT, RECEIVED - 4_000, RECEIVED)).toBe(0)
  })

  it('ages from the receipt: live at the limit, stale one millisecond after', () => {
    expect(ibViewState(LIVE_SNAPSHOT, false, RECEIVED + STALE_AFTER_MS, RECEIVED)).toBe('live')
    expect(ibViewState(LIVE_SNAPSHOT, false, RECEIVED + STALE_AFTER_MS + 1, RECEIVED)).toBe('stale')
  })

  it("counts the server's own age_s of a cached body", () => {
    expect(snapshotAgeMs(cached(4), RECEIVED + 6_000, RECEIVED)).toBe(10_000)
    expect(ibViewState(cached(29), false, RECEIVED + 2_000, RECEIVED)).toBe('stale')
  })

  it('still needs a usable read time, and still honours the failed flag', () => {
    expect(ibViewState({ ...LIVE_SNAPSHOT, fetched_at_utc: null }, false, RECEIVED, RECEIVED)).toBe('stale')
    expect(ibViewState(LIVE_SNAPSHOT, true, RECEIVED, RECEIVED)).toBe('stale')
  })
})

describe('snapshotAgeMs and formatAge', () => {
  it('measures from the time the body was read', () => {
    expect(snapshotAgeMs(LIVE_SNAPSHOT, NOW_FRESH_MS)).toBe(8_000)
  })
  it('is null without a usable time', () => {
    expect(snapshotAgeMs(DISABLED_SNAPSHOT, NOW_FRESH_MS)).toBeNull()
  })
  it('writes seconds, minutes, hours and days', () => {
    expect(formatAge(8_000)).toBe('8 s')
    expect(formatAge(59_999)).toBe('59 s')
    expect(formatAge(5 * 60_000)).toBe('5 min')
    expect(formatAge(3 * 3_600_000 + 10 * 60_000)).toBe('3 h')
    expect(formatAge(2 * 86_400_000)).toBe('2 d')
  })
  it('never writes a negative age', () => {
    expect(formatAge(-5_000)).toBe('0 s')
  })
})

describe('maskAccount and maskAccounts', () => {
  it('passes the API form through', () => {
    expect(maskAccount('DU*******')).toBe('DU*******')
  })
  it('masks a raw id down to two characters and asterisks', () => {
    expect(maskAccount('DU1234567')).toBe('DU*******')
    expect(maskAccount('U9876543')).toBe('U9******')
  })
  it('shows a dash when there is no account', () => {
    expect(maskAccount(null)).toBe('--')
    expect(maskAccount('')).toBe('--')
    expect(maskAccounts([])).toBe('--')
  })
  it('lists every account TWS reported, each masked again', () => {
    expect(maskAccounts(['DU*******', 'DU7654321'])).toBe('DU*******, DU*******')
  })
})

describe('formatting', () => {
  it('reads net liquidation from the summary rows, with grouping, two decimals and the currency', () => {
    expect(netLiquidation(LIVE_SNAPSHOT.summary)).toBe('1,000,482.55 USD')
    expect(netLiquidation([])).toBe('--')
  })
  it('skips a net liquidation row that holds no number', () => {
    const text = { ...LIVE_SNAPSHOT.summary[1]!, number: null }
    expect(netLiquidation([text])).toBe('--')
  })
  it('formats a UTC time of day', () => {
    expect(formatUtcTime('2026-10-01T13:59:31Z')).toBe('13:59:31 UTC')
    expect(formatUtcTime('2026-10-01T13:59:31.250+00:00')).toBe('13:59:31 UTC')
    expect(formatUtcTime(null)).toBe('--')
    expect(formatUtcTime('junk')).toBe('--')
  })
  it('puts the accounts, net liquidation, both clocks and the client id in the strip', () => {
    expect(accountItems(LIVE_SNAPSHOT).map((i) => [i.key, i.value])).toEqual([
      ['account', 'DU*******'],
      ['netLiquidation', '1,000,482.55 USD'],
      ['asOf', '14:02:00 UTC'],
      ['twsTime', '14:01:59 UTC'],
      ['clientId', '95'],
    ])
  })
})

describe('rows', () => {
  it('positions: signed quantities with a tone, average cost with two decimals', () => {
    const rows = positionRows(LIVE_SNAPSHOT)
    expect(rows.map((r) => [r.symbol, r.position, r.tone, r.avgCost, r.expiry])).toEqual([
      ['MNQZ6', '+6', 'up', '41,250.50', '20261218'],
      ['MESZ6', '-2', 'down', '6,020.25', '20261218'],
    ])
  })
  it('positions: a flat position has no tone and a missing cost or expiry is a dash', () => {
    const flat = { ...LIVE_SNAPSHOT.positions[0]!, quantity: 0, average_cost: null, expiry: '' }
    const row = positionRows({ ...LIVE_SNAPSHOT, positions: [flat] })[0]!
    expect(row.position).toBe('0')
    expect(row.tone).toBeUndefined()
    expect(row.avgCost).toBe('--')
    expect(row.expiry).toBe('--')
  })
  it('working instructions: action, quantity, limit and status as TWS listed them', () => {
    const rows = workingRows(LIVE_SNAPSHOT)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      symbol: 'MNQZ6', action: 'SELL', kind: 'LMT', quantity: '6', limit: '21,900.25',
      status: 'Submitted', filled: '0', remaining: '6', tone: 'down',
    })
  })
  it('working instructions: a market instruction has no limit price', () => {
    const market = { ...LIVE_SNAPSHOT.open_orders[0]!, order_type: 'MKT', limit_price: null, filled: null, remaining: null }
    const rows = workingRows({ ...LIVE_SNAPSHOT, open_orders: [market] })
    expect(rows[0]).toMatchObject({ limit: '--', filled: '--', remaining: '--' })
  })
  it('executions: the time as TWS sent it, side with a tone, price and exchange', () => {
    const rows = executionRows(LIVE_SNAPSHOT)
    expect(rows[0]).toMatchObject({
      key: '0001f4e8.6501a2b3.01.01', time: '20261001 09:59:31 US/Eastern', symbol: 'MNQZ6', side: 'BOT',
      shares: '6', price: '21,850.50', exchange: 'CME', tone: 'up',
    })
  })
  it('empty lists give no rows', () => {
    expect(positionRows(EMPTY_SNAPSHOT)).toEqual([])
    expect(workingRows(EMPTY_SNAPSHOT)).toEqual([])
    expect(executionRows(EMPTY_SNAPSHOT)).toEqual([])
  })
})

describe('readIbSnapshot', () => {
  it('accepts a well-formed body of each state', () => {
    expect(readIbSnapshot(LIVE_SNAPSHOT)).toEqual(LIVE_SNAPSHOT)
    for (const body of [DISABLED_SNAPSHOT, UNAVAILABLE_SNAPSHOT, REFUSED_SNAPSHOT]) expect(readIbSnapshot(body)).toEqual(body)
  })
  it('refuses anything else', () => {
    expect(readIbSnapshot(null)).toBeNull()
    expect(readIbSnapshot('ok')).toBeNull()
    expect(readIbSnapshot({})).toBeNull()
    expect(readIbSnapshot({ ...LIVE_SNAPSHOT, state: 'connected' })).toBeNull()
    expect(readIbSnapshot({ ...LIVE_SNAPSHOT, state: 'off' })).toBeNull()
    expect(readIbSnapshot({ ...LIVE_SNAPSHOT, positions: 'none' })).toBeNull()
    expect(readIbSnapshot({ ...LIVE_SNAPSHOT, executions: null })).toBeNull()
    expect(readIbSnapshot({ ...LIVE_SNAPSHOT, message: 5 })).toBeNull()
    expect(readIbSnapshot({ ...LIVE_SNAPSHOT, summary: undefined })).toBeNull()
  })
})
