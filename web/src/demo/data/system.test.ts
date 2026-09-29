// G01 (polish 3): the demo command index is as wide as the lists on screen. The real backend builds the
// hypotheses of GET /api/commands from the registry and the runs from every result folder
// (backend/nq_terminal/api/commands.py), so REG and RUNS can drill into any row they show. The demo used to
// index only the ids it holds a body for, and the parser answered 'X is not a known instrument, hypothesis
// or run.' beside a list that showed X. Ids without a captured body now parse, and the route answers the
// honest 'not in the demo dataset' 404 instead.
import { describe, expect, it } from 'vitest'
import { parseLine } from '../../commands/line'
import type { CommandIndexData } from '../../commands/types'
import { HYPOTHESIS_DETAILS, REGISTRY } from './research'
import { RUNS, RUN_DETAILS } from './runs'
import { COMMAND_INDEX } from './system'

const INDEX = COMMAND_INDEX as unknown as CommandIndexData
const parse = (line: string) => parseLine(line, { index: INDEX })

describe('COMMAND_INDEX lists every id the REG and RUNS screens show (G01)', () => {
  it('holds all registry rows as hypotheses', () => {
    expect(REGISTRY.rows.length).toBeGreaterThan(20)
    for (const row of REGISTRY.rows) expect(COMMAND_INDEX.hypotheses, row.name).toContain(row.name)
  })

  it('holds all runs of the RUNS list', () => {
    expect(RUNS).toHaveLength(6)
    for (const run of RUNS) expect(COMMAND_INDEX.runs, run.run_id).toContain(run.run_id)
  })

  it('still holds every id the demo serves a body for (nothing became unreachable)', () => {
    for (const name of HYPOTHESIS_DETAILS.keys()) expect(COMMAND_INDEX.hypotheses, name).toContain(name)
    for (const id of RUN_DETAILS.keys()) expect(COMMAND_INDEX.runs, id).toContain(id)
  })

  it('lists each id once', () => {
    expect(new Set(COMMAND_INDEX.hypotheses).size).toBe(COMMAND_INDEX.hypotheses.length)
    expect(new Set(COMMAND_INDEX.runs).size).toBe(COMMAND_INDEX.runs.length)
  })
})

describe('lines the screens offer parse (G01)', () => {
  it.each([
    'tom_v0 DES',
    'eomtsy_v0 DES',
    'overnight_v0 DES',
    'vt_har_v0 DES',
    'nt_volmanaged_v0_fixture_m1 RUN',
    'smoke_2015_01 EQ',
    'nt_dtsmom_v0_fixture_ts1 RUN',
  ])('%s is a run of a screen, not an unknown id', (line) => {
    const result = parse(line)
    expect(result.ok, JSON.stringify(result)).toBe(true)
  })

  it('every REG row and RUNS row parses as a DES or RUN line', () => {
    for (const row of REGISTRY.rows) expect(parse(`${row.name} DES`).ok, row.name).toBe(true)
    for (const run of RUNS) expect(parse(`${run.run_id} RUN`).ok, run.run_id).toBe(true)
  })

  it('still rejects an id that no screen shows', () => {
    const result = parse('no_such_hypothesis_v9 DES')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('unknown-context')
  })
})
