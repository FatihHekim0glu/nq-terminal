// RUNS and RUN model (TASKS 6.3, UI_SPEC sections 6 and 7, look spec 7.4): badges, tabs, filters,
// number formats and the compare-request chunks, checked against the fixture-mode API responses.
import { describe, expect, it } from 'vitest'
import {
  balanceBadge,
  checkText,
  compareChunks,
  compareGroups,
  decimalsFor,
  formatExact,
  formatFraction,
  formatRatio,
  formatUsd,
  inRunsTab,
  logColumns,
  matchesRunFilter,
  runTags,
  statsById,
  strategiesOf,
  benchOwnPane,
} from './model'
import { COMPARE_STATS, RUNS } from './runs.fixtures'
import { RUN_TAGS } from './copy'

const byId = (id: string) => {
  const run = RUNS.find((r) => r.run_id === id)
  if (!run) throw new Error(`no fixture run ${id}`)
  return run
}

describe('runTags: the honesty badges of UI_SPEC section 6', () => {
  it('marks a failed balance check [UNUSABLE: BALANCE]', () => {
    expect(runTags(byId('nt_za_v0_fixture_unbalanced'))).toEqual([RUN_TAGS.unusableBalance])
  })

  it('marks a ledgered run and nothing else on a clean run', () => {
    expect(runTags(byId('nt_overnight_v0_fixture_open'))).toEqual([RUN_TAGS.ledgered])
    expect(runTags(byId('nt_dtsmom_v0_fixture_ts1'))).toEqual([])
  })

  it('marks probes, anchors, unreadable runs and other unusable runs', () => {
    const base = byId('nt_dtsmom_v0_fixture_ts1')
    expect(runTags({ ...base, is_probe: true })).toContain('[PROBE: never a result]')
    expect(runTags({ ...base, is_anchor: true, anchor_of: 'x' })).toContain('[ANCHOR]')
    expect(runTags({ ...base, readable: false, usable: false, error: 'bad json' })).toContain(RUN_TAGS.unreadable)
    expect(runTags({ ...base, usable: false, balance_ok: null })).toEqual([RUN_TAGS.unusable])
  })
})

describe('badges and check text', () => {
  it('reads a balance flag as text as well as colour', () => {
    expect(balanceBadge(true)).toEqual({ text: '[OK]', tone: 'up' })
    expect(balanceBadge(false)).toEqual({ text: '[FAIL]', tone: 'down' })
    expect(balanceBadge(null)).toEqual({ text: '[NOT RECORDED]', tone: 'muted' })
  })

  it('never reads a missing check as a pass', () => {
    expect(checkText(true)).toBe('ok')
    expect(checkText(false)).toBe('FAIL')
    expect(checkText(null)).toBe('--')
  })
})

describe('tabs and filters', () => {
  it('splits the runs into the RUNS sub-tabs', () => {
    const ids = (tab: Parameters<typeof inRunsTab>[1]) => RUNS.filter((r) => inRunsTab(r, tab)).map((r) => r.run_id)
    expect(ids('all')).toHaveLength(RUNS.length)
    expect(ids('ledgered')).toEqual(['nt_overnight_v0_fixture_open'])
    expect(ids('unusable')).toEqual(['nt_za_v0_fixture_unbalanced'])
    expect(ids('anchors')).toEqual([])
    expect(ids('probes')).toEqual([])
  })

  it('filters on run id, strategy and variant, ignoring case', () => {
    const run = byId('nt_za_v0_fixture_a')
    expect(matchesRunFilter(run, '')).toBe(true)
    expect(matchesRunFilter(run, 'ZA_ORB')).toBe(true)
    expect(matchesRunFilter(run, 'fixture_a')).toBe(true)
    expect(matchesRunFilter(run, 'repaired')).toBe(true)
    expect(matchesRunFilter(run, 'dtsmom')).toBe(false)
  })

  it('lists each strategy once, sorted', () => {
    expect(strategiesOf(RUNS)).toEqual(['dtsmom', 'overnight', 'volmanaged', 'za_orb'])
  })
})

describe('compareChunks: every readable run in requests under the contract limit', () => {
  it('keeps one request when the ids fit', () => {
    expect(compareChunks(['a', 'b', 'c'])).toEqual([['a', 'b', 'c']])
  })

  it('splits so no joined list passes the limit and no id is lost', () => {
    const ids = Array.from({ length: 90 }, (_, i) => `nt_some_long_strategy_name_v0_${i}`)
    const chunks = compareChunks(ids, 200)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.join(',').length <= 200)).toBe(true)
    expect(chunks.flat()).toEqual(ids)
  })

  it('returns no chunk for no ids', () => {
    expect(compareChunks([])).toEqual([])
  })
})

describe('compareGroups: the older /api/runs/compare fallback takes 2 to 8 distinct ids per request', () => {
  it('splits into groups of 2 to 8 and loses no id', () => {
    const ids = Array.from({ length: 17 }, (_, i) => `r${i}`)
    const groups = compareGroups(ids)
    expect(groups.every((g) => g.length >= 2 && g.length <= 8)).toBe(true)
    expect(groups.flat()).toEqual(ids)
  })

  it('born failing: a lone last id joins the group before it', () => {
    expect(compareGroups(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']).map((g) => g.length)).toEqual([7, 2])
  })

  it('cannot compare one run on its own', () => {
    expect(compareGroups(['a'])).toEqual([])
  })
})

describe('number formats (look spec 3.4): fixed decimals, explicit sign, -- for missing', () => {
  it('prints USD with thousands and two decimals, signed on request', () => {
    expect(formatUsd(60658.125, true)).toBe('+60,658.13')
    expect(formatUsd(-3580.28, true)).toBe('-3,580.28')
    expect(formatUsd(881.25)).toBe('881.25')
    expect(formatUsd(0, true)).toBe('0.00')
    expect(formatUsd(null)).toBe('--')
  })

  it('prints ratios and fractions as percentages', () => {
    expect(formatRatio(8.34493200549961)).toBe('8.34')
    expect(formatRatio(-5.818080911225993)).toBe('-5.82')
    expect(formatRatio(null)).toBe('--')
    expect(formatFraction(0.75, 1)).toBe('75.0%')
    expect(formatFraction(-0.00010310735906804425, 3)).toBe('-0.010%')
    expect(formatFraction(undefined, 1)).toBe('--')
  })

  it('shows exact API values with the decimals the column needs', () => {
    expect(decimalsFor([135, 131.64, 1083, 0.00390625])).toBe(8)
    expect(decimalsFor([1, 2, 3])).toBe(0)
    expect(decimalsFor([5790.5, 5786.25, null])).toBe(2)
    expect(formatExact(131.64, 2)).toBe('131.64')
    expect(formatExact(1083, 2)).toBe('1083.00')
    expect(formatExact(null, 2)).toBe('--')
  })
})

describe('statsById and logColumns', () => {
  it('indexes the compare stats by run id', () => {
    const stats = statsById([COMPARE_STATS])
    expect(stats.get('nt_dtsmom_v0_fixture_ts1')?.sharpe).toBe(8.34493200549961)
    expect(stats.get('nt_za_v0_fixture_unbalanced')?.sharpe).toBeNull()
  })

  it('takes the log columns in first-seen order across rows', () => {
    const cols = logColumns([{ date: '2012-01-20', symbol: 'RB' }, { date: '2012-01-23', held: -6 }])
    expect(cols).toEqual(['date', 'symbol', 'held'])
  })
})

describe('benchOwnPane (RUN chart: a benchmark that would flatten the strategy gets its own pane)', () => {
  it('splits when the strategy would fill under a fifth of a shared axis', () => {
    // nt_za_v0_fixture_a: equity 999,905 to 1,001,053 against buy and hold up to 5,778,540.
    expect(benchOwnPane([999905, 1000500, 1001053.12], [1000000, 3000000, 5778540.28])).toBe(true)
  })

  it('keeps one axis when both lines are readable on it, or when there is no benchmark', () => {
    expect(benchOwnPane([1000000, 1100000, 1200000], [1000000, 1050000, 1300000])).toBe(false)
    expect(benchOwnPane([1, 2, 3], null)).toBe(false)
    expect(benchOwnPane([null, null], [1, 2])).toBe(false)
  })
})
