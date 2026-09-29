import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { OOS, OPENINGS } from '../../copy/oos'
import {
  callerOptions,
  dayBandLines,
  alertText,
  entriesCsv,
  entryResult,
  entryTime,
  newestFirst,
  openingsCard,
  resultText,
  severityLegend,
  severitySteps,
  severityText,
  sinceValid,
  swimlaneData,
  windowText,
} from './oosModel'

type Entry = Schemas['OosLogEntry']

function entry(over: Partial<Entry> = {}): Entry {
  return {
    alert: false,
    caller: 'za_screen',
    end: '2022-01-01 00:00:00+00:00',
    end_epoch_s: 1640995200,
    is_sealed: false,
    key_set: 'k4',
    line_no: 1,
    past_fence: false,
    reason: 'pre-registered za_v0 screen',
    rows: 3129157,
    sealed: null,
    severity: 2,
    spec_sha256: null,
    start: '2010-09-28 00:00:00+00:00',
    start_epoch_s: 1285632000,
    symbol: 'NQ.V.0',
    timeframe: '1m',
    variant: 'repaired',
    ts_epoch_s: 1790386325,
    ts_utc: '2026-09-25T21:32:05.600302+00:00',
    ...over,
  }
}

const OPENING = {
  caller: 'rebal_v1_confirm',
  window: ['2021-10-01T00:00:00+00:00', '2026-09-01T00:00:00+00:00'],
  symbols: ['NQ.V.0', 'ZN.V.0'],
  decided_by: 'user',
  decided_utc: '2026-09-26T10:47:46.666928+00:00',
  closed: true,
  closed_utc: '2026-09-26T11:15:20.324713+00:00',
}

function openings(over: Partial<Schemas['Openings']> = {}): Schemas['Openings'] {
  return {
    label: 'spent window, opened 2026-09-26, descriptive only',
    openings: [OPENING],
    openings_closed: true,
    openings_pin_ok: true,
    openings_sha256: 'abc',
    pinned: { openings_sha256: 'abc', sealed_log_lines: 2, sealed_log_sha256: 'def' },
    sealed_log: { lines: 2, sha256: 'def' },
    sealed_log_pin_ok: true,
    ...over,
  }
}

describe('entry text', () => {
  it('shows the logged UTC time to the second, exactly as written', () => {
    expect(entryTime(entry())).toBe('2026-09-25 21:32:05')
    expect(entryTime(entry({ ts_utc: 'not a time' }))).toBe('not a time')
  })

  it('shows the data window as two ISO dates', () => {
    expect(windowText(entry())).toBe('2010-09-28..2022-01-01')
    expect(windowText(entry({ start: '', end: '' }))).toBe('--..--')
  })

  it('classes a read as served, past the fence or sealed, sealed first', () => {
    expect(entryResult(entry())).toBe('served')
    expect(entryResult(entry({ past_fence: true }))).toBe('past')
    expect(entryResult(entry({ past_fence: true, is_sealed: true }))).toBe('sealed')
    expect(resultText('served')).toBe(OOS.resultServed)
    expect(resultText('sealed')).toBe(OOS.resultSealed)
    expect(resultText('past')).toBe(OOS.resultPast)
  })
})

describe('ordering and day bands', () => {
  it('puts the newest entry first without changing the input', () => {
    const list = [entry({ line_no: 1 }), entry({ line_no: 2 })]
    expect(newestFirst(list).map((e) => e.line_no)).toEqual([2, 1])
    expect(list.map((e) => e.line_no)).toEqual([1, 2])
  })

  it('alternates the band by UTC day, starting unbanded', () => {
    const rows = [
      entry({ line_no: 5, ts_utc: '2026-09-27T09:00:00+00:00' }),
      entry({ line_no: 4, ts_utc: '2026-09-27T08:00:00+00:00' }),
      entry({ line_no: 3, ts_utc: '2026-09-26T12:00:00+00:00' }),
      entry({ line_no: 2, ts_utc: '2026-09-25T21:00:00+00:00' }),
    ]
    expect([...dayBandLines(rows)].sort()).toEqual([3])
  })
})

describe('caller options', () => {
  it('lists all callers first, then callers by read count', () => {
    const options = callerOptions({ terminal: 2, za_screen: 5, gate_selfcheck: 1 })
    expect(options[0]).toEqual({ value: '', label: OOS.allCallers })
    expect(options.slice(1).map((o) => o.value)).toEqual(['za_screen', 'terminal', 'gate_selfcheck'])
    expect(options[1]!.label).toBe('za_screen (5)')
  })

  it('adds a selected caller the log has no reads for, right after All callers, with 0 reads', () => {
    const options = callerOptions({ terminal: 2, za_screen: 5 }, 'za_v0')
    expect(options.slice(0, 2)).toEqual([{ value: '', label: OOS.allCallers }, { value: 'za_v0', label: 'za_v0 (0)' }])
    expect(options.slice(2).map((o) => o.value)).toEqual(['za_screen', 'terminal'])
  })

  it('adds nothing when the selected caller is in the log, or nothing is selected', () => {
    const counts = { terminal: 2, za_screen: 5 }
    expect(callerOptions(counts, 'za_screen')).toEqual(callerOptions(counts))
    expect(callerOptions(counts, '')).toEqual(callerOptions(counts))
    expect(callerOptions(counts, 'za_screen').map((o) => o.value)).toEqual(['', 'za_screen', 'terminal'])
  })

  it('adds the selected caller to an empty log too', () => {
    expect(callerOptions({}, 'za_v0').map((o) => o.label)).toEqual([OOS.allCallers, 'za_v0 (0)'])
  })
})

describe('since filter', () => {
  it('accepts an empty field or an ISO date only', () => {
    expect(sinceValid('')).toBe(true)
    expect(sinceValid('2026-09-26')).toBe(true)
    expect(sinceValid('26/09/2026')).toBe(false)
    expect(sinceValid('2026-13-01')).toBe(false)
  })
})

describe('swimlane data', () => {
  it('draws each read with its window and marks sealed reads', () => {
    const data = swimlaneData([entry(), entry({ caller: 'serve_sealed', is_sealed: true, start_epoch_s: 1633046400, end_epoch_s: 1788220800 })], ['za_screen', 'serve_sealed'])
    expect(data.input.reads).toEqual([
      { caller: 'za_screen', start: 1285632000, end: 1640995200, sealed: false },
      { caller: 'serve_sealed', start: 1633046400, end: 1788220800, sealed: true },
    ])
    expect(data.input.lanes).toEqual(['za_screen', 'serve_sealed'])
    expect(data.skipped).toBe(0)
  })

  it('leaves out and counts entries without a readable window', () => {
    const data = swimlaneData([entry({ start_epoch_s: null }), entry({ start_epoch_s: 10, end_epoch_s: 5 }), entry()], [])
    expect(data.input.reads).toHaveLength(1)
    expect(data.skipped).toBe(2)
  })
})

describe('openings card', () => {
  it('reads the one closed opening with its dates and pins', () => {
    const card = openingsCard(openings())
    expect(card.rows).toHaveLength(1)
    const row = card.rows[0]!
    expect(row.opened).toBe('opened 2026-09-26 by user')
    expect(row.state).toBe(OPENINGS.closedTag)
    expect(row.closed).toBe('closed 2026-09-26')
    expect(row.window).toBe('window 2021-10-01..2026-09-01')
    expect(row.symbols).toBe('symbols NQ.V.0, ZN.V.0')
    expect(card.pins).toEqual([
      { text: OPENINGS.pinOk, ok: true },
      { text: OPENINGS.logPinOk, ok: true },
    ])
    expect(card.sealedLines).toBe('sealed lines 2 of 2 pinned')
  })

  it('says OPEN for an opening not closed, and FAILED or unknown for pins', () => {
    const card = openingsCard(openings({
      openings: [{ ...OPENING, closed: false, closed_utc: null }],
      openings_pin_ok: false,
      sealed_log_pin_ok: null,
      sealed_log: null,
    }))
    expect(card.rows[0]!.state).toBe(OPENINGS.openTag)
    expect(card.rows[0]!.closed).toBeNull()
    expect(card.pins).toEqual([
      { text: OPENINGS.pinBad, ok: false },
      { text: OPENINGS.logPinUnknown, ok: null },
    ])
    expect(card.sealedLines).toBeNull()
  })

  it('tolerates odd types in the untrusted openings file', () => {
    const card = openingsCard(openings({ openings: [{ decided_utc: 5, window: 'x', symbols: null, closed: 'yes' }] }))
    const row = card.rows[0]!
    expect(row.opened).toBe('opened -- by --')
    expect(row.window).toBe('window --..--')
    expect(row.symbols).toBe('symbols --')
    expect(row.state).toBe(OPENINGS.openTag)
  })
})

describe('CSV export', () => {
  it('writes one quoted row per entry with the shown columns', () => {
    const csv = entriesCsv([entry({ reason: 'say "hi", then go' })])
    const [head, row] = csv.split('\r\n')
    expect(head).toBe('ts_utc,caller,reason,symbol,timeframe,variant,start,end,rows,result,severity,alert')
    expect(row).toBe('"2026-09-25T21:32:05.600302+00:00","za_screen","say ""hi"", then go","NQ.V.0","1m","repaired","2010-09-28 00:00:00+00:00","2022-01-01 00:00:00+00:00","3129157","served","2","false"')
  })

  it('neutralises a cell that a spreadsheet would read as a formula', () => {
    const csv = entriesCsv([entry({ reason: '=HYPERLINK("x")' })])
    expect(csv).toContain('"\'=HYPERLINK(""x"")"')
  })
})

const LEVELS: Schemas['SeverityLevel'][] = [
  { level: 1, meaning: 'terminal display read, inside the in-sample window' },
  { level: 2, meaning: 'research read by another caller, inside the in-sample window' },
  { level: 3, meaning: 'window past the fence, before the in-sample start, or unreadable: check it' },
  { level: 4, meaning: 'sealed read (spent window)' },
]

describe('the R severity column and the A alert (look spec 7.10, house semantics from the API)', () => {
  it('draws the API severity as 1 to 4 steps, and says it in words with its meaning', () => {
    expect(severitySteps(entry({ severity: 3 }))).toBe(3)
    expect(severitySteps(entry({ severity: 9 }))).toBe(4)
    expect(severitySteps(entry({ severity: 0 }))).toBe(1)
    expect(severityText(entry({ severity: 4 }), LEVELS)).toBe('severity 4 of 4: sealed read (spent window)')
    expect(severityText(entry({ severity: 2 }), [])).toBe('severity 2 of 4')
  })

  it('flags the alert the API sets, naming why', () => {
    expect(alertText(entry({ alert: false }))).toBeNull()
    expect(alertText(entry({ alert: true, is_sealed: true }))).toBe(OOS.alertSealed)
    expect(alertText(entry({ alert: true, past_fence: true }))).toBe(OOS.alertPast)
    expect(alertText(entry({ alert: true }))).toBe(OOS.alertCheck)
  })

  it('lists each level with its meaning and its count over the whole log, highest first', () => {
    expect(severityLegend(LEVELS, { '1': 2, '2': 12, '4': 2 })).toEqual([
      { level: 4, text: '4 sealed read (spent window): 2' },
      { level: 3, text: '3 window past the fence, before the in-sample start, or unreadable: check it: 0' },
      { level: 2, text: '2 research read by another caller, inside the in-sample window: 12' },
      { level: 1, text: '1 terminal display read, inside the in-sample window: 2' },
    ])
  })
})
