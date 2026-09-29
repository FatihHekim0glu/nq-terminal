import { describe, expect, it } from 'vitest'
import analyticsCatalogue from '../../../docs/ANALYTICS_CATALOG.md?raw'
import { CHROME_WORDS } from '../copy/commands'
import { HELP_TOPICS } from '../copy/helpTopics'
import { CONTRACT_NAMES } from '../copy/market'
import { SEARCH } from '../copy/search'
import { METRIC_ENTRIES } from '../copy/searchMetrics'
import { isBuilt } from './built'
import { parseLine } from './line'
import { MNEMONICS } from './registry'
import { buildSearchIndex, searchEntries, type SearchGroup, type SearchHit } from './searchIndex'

const index = buildSearchIndex()
const hits = (query: string): readonly SearchHit[] => searchEntries(index, query)
const GROUPS: readonly SearchGroup[] = ['function', 'word', 'metric', 'instrument', 'help']
const detailsOf = (found: readonly SearchHit[]): string[] => found.map((h) => h.entry.detail)

describe('searchEntries: the ranks (0 exact, 1 catalogue id, 2 label prefix, 3 whole word, 4 substring, 5 help prose, 6 fuzzy)', () => {
  it('ranks an exact function code or chrome word 0', () => {
    expect(hits('gp')[0]).toMatchObject({ rank: 0, entry: { group: 'function', label: 'GP' } })
    expect(hits('GP')[0]).toMatchObject({ rank: 0, entry: { group: 'function', label: 'GP' } })
    expect(hits('undo')[0]).toMatchObject({ rank: 0, entry: { group: 'word', label: 'UNDO' } })
    expect(hits('cl1')[0]).toMatchObject({ rank: 0, entry: { group: 'instrument', label: 'CL' } })
  })

  it('ranks a catalogue id 1, in either case', () => {
    for (const query of ['RK3', 'rk3']) {
      const first = hits(query)[0]
      expect(first, query).toMatchObject({ rank: 1, entry: { group: 'metric', label: 'RET', act: { kind: 'run', line: 'RET' } } })
      expect(first?.entry.detail).toContain('(RK3)')
    }
  })

  it('ranks a label prefix 2, a whole word 3, a substring 4 and a fuzzy label 6', () => {
    const rank = (query: string, id: string): number | undefined => hits(query).find((h) => h.entry.detail.includes(`(${id})`))?.rank
    expect(rank('calm', 'PF6')).toBe(2)
    expect(rank('ratio', 'PF6')).toBe(3)
    expect(rank('harpe', 'PF4')).toBe(4)
    expect(rank('clmr', 'PF6')).toBe(6)
  })

  it('ranks help prose 5 and gives the phrase; every other rank has none', () => {
    const prose = hits('deflated').filter((h) => h.entry.group === 'help')
    expect(prose.length).toBeGreaterThan(0)
    for (const h of prose) {
      expect(h.rank).toBe(5)
      expect(h.phrase?.toLowerCase()).toContain('deflated')
    }
    for (const h of hits('sharpe').filter((x) => x.entry.group !== 'help')) expect(h.phrase, h.entry.label).toBeNull()
  })

  it('matches fuzzily only from four characters, so a short query is not spread over every label', () => {
    expect(hits('oil').filter((h) => h.rank === 6)).toEqual([])
    expect(hits('var').filter((h) => h.rank === 6)).toEqual([])
    expect(hits('drwd').some((h) => h.rank === 6 && h.entry.detail.includes('(DD1)'))).toBe(true)
  })

  it('sorts by rank, then group (function, word, metric, instrument, help), then label', () => {
    for (const query of ['a', 'ret', 'return', 'oil', 'gp', 'sharpe']) {
      const found = hits(query)
      const key = (h: SearchHit): [number, number, string] => [h.rank, GROUPS.indexOf(h.entry.group), h.entry.label.toLowerCase()]
      for (let i = 1; i < found.length; i += 1) {
        const [a, b] = [key(found[i - 1] as SearchHit), key(found[i] as SearchHit)]
        const order = a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0)
        expect(order, `${query}: ${a.join('/')} before ${b.join('/')}`).toBeLessThanOrEqual(0)
      }
    }
  })

  it('gives at most 6 hits per group, and the cap does bite', () => {
    const counts = (query: string): Record<string, number> => {
      const out: Record<string, number> = {}
      for (const h of hits(query)) out[h.entry.group] = (out[h.entry.group] ?? 0) + 1
      return out
    }
    for (const query of ['a', 'e', 'r', 'ratio', 'return', 'oil', 'the', 'rolling', 'st']) {
      for (const [group, n] of Object.entries(counts(query))) expect(n, `${query} ${group}`).toBeLessThanOrEqual(6)
    }
    expect(counts('a').metric).toBe(6)
    expect(counts('a').help).toBe(6)
  })
})

describe('searchEntries: the queries the brief names', () => {
  it("'calmar' finds PF6, run as EQ", () => {
    expect(hits('calmar')[0]).toMatchObject({
      rank: 2,
      entry: { group: 'metric', label: 'EQ', detail: 'Metric: Calmar ratio (PF6), Analytics: equity', act: { kind: 'run', line: 'EQ' } },
    })
  })

  it("'crude' finds the CL instrument as a context act", () => {
    expect(hits('crude')[0]).toMatchObject({
      entry: { group: 'instrument', label: 'CL', detail: 'Instrument: Crude Oil', act: { kind: 'context', context: { kind: 'instrument', value: 'CL' } } },
    })
  })

  it("'deflated' finds SV3 (on MT) and a help page with a phrase", () => {
    const found = hits('deflated')
    expect(found[0]).toMatchObject({ entry: { group: 'metric', label: 'MT', act: { kind: 'run', line: 'MT' } } })
    expect(found[0]?.entry.detail).toContain('(SV3)')
    const help = found.find((h) => h.entry.group === 'help')
    expect(help).toMatchObject({ rank: 5, entry: { label: 'DES HELP', code: 'DES', act: { kind: 'run', line: 'DES HELP' } } })
    expect(help?.phrase).toMatch(/Deflated Sharpe/)
  })

  it("'sharpe' has PF4 among its top 3", () => {
    expect(detailsOf(hits('sharpe').slice(0, 3)).some((d) => d.includes('(PF4)'))).toBe(true)
  })

  it("'omega' finds PF7 on RET, the demo check", () => {
    expect(hits('omega')[0]).toMatchObject({ entry: { group: 'metric', label: 'RET', act: { kind: 'run', line: 'RET' } } })
  })

  it('finds nothing for a query that matches nothing, for an empty query and for blanks', () => {
    expect(hits('flurble')).toEqual([])
    expect(hits('')).toEqual([])
    expect(hits('   ')).toEqual([])
  })
})

describe('searchEntries: hostile and odd queries', () => {
  it('reads regex and markup characters as plain text', () => {
    expect(() => hits('(.*')).not.toThrow()
    expect(() => hits('[[')).not.toThrow()
    expect(hits('[post hoc]').length).toBeGreaterThan(0)
    expect(hits('.*')).toEqual([])
    expect(hits('<script>')).toEqual([])
    expect(hits("'; drop table")).toEqual([])
  })

  it('is case and space insensitive', () => {
    expect(hits('  CALMAR  ')).toEqual(hits('calmar'))
    expect(hits('Sharpe   RATIO')).toEqual(hits('sharpe ratio'))
  })

  it('copes with unicode, emoji and a very long query', () => {
    expect(hits('éèê')).toEqual([])
    expect(hits('\u{1F4C8}')).toEqual([])
    expect(hits('x'.repeat(5000))).toEqual([])
  })

  it('is fast over the whole index', () => {
    const start = performance.now()
    for (let i = 0; i < 200; i += 1) hits('drawdown')
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

describe('the help phrase', () => {
  const phraseOf = (query: string): string => hits(query).find((h) => h.phrase !== null)?.phrase ?? ''

  it('is cut to about 60 characters around the match and marked with ... where it is cut', () => {
    for (const query of ['deflated', 'realised volatility', 'sha256', 'link group', 'fence']) {
      const phrase = phraseOf(query)
      expect(phrase.length, query).toBeGreaterThan(0)
      expect(phrase.length, `${query}: ${phrase}`).toBeLessThanOrEqual(70)
      expect(phrase.replace(/^\.\.\./, '').replace(/\.\.\.$/, '').toLowerCase(), query).toContain(query)
    }
    expect(phraseOf('deflated').startsWith('...')).toBe(true)
  })

  it('is the sentence that holds the match, not the whole line of prose', () => {
    const gp = (query: string): string | null => hits(query).find((h) => h.entry.group === 'help' && h.entry.code === 'GP')?.phrase ?? null
    // GP's data line has two sentences: a match in the second one starts at its first word ...
    expect(HELP_TOPICS.GP?.data).toContain('. In-sample only: nothing after 2021-12-31 is served.')
    expect(gp('in-sample only')).toBe('In-sample only: nothing after 2021-12-31 is served.')
    // ... and a match in the first one stops at its full stop, however long the line goes on.
    expect(gp('caller terminal')).toMatch(/^\.\.\..*caller terminal\.$/)
    expect(gp('caller terminal')).not.toContain('In-sample')
  })

  it('holds a query longer than the width whole', () => {
    const long = (HELP_TOPICS.GP?.data ?? '').slice(0, 90).toLowerCase()
    const phrase = hits(long).find((h) => h.entry.group === 'help' && h.entry.code === 'GP')?.phrase ?? ''
    expect(phrase.toLowerCase()).toContain(long)
  })

  it('keeps a short sentence whole, with no ...', () => {
    const gip = hits('intraday').find((h) => h.entry.group === 'help' && h.entry.code === 'GIP')
    expect(gip?.phrase).toBe(HELP_TOPICS.GIP?.summary)
  })
})

describe('the entries', () => {
  const entries = index.entries

  it('has one function entry per registry code, run as today (a fill when the function takes a context)', () => {
    const functions = entries.filter((e) => e.group === 'function')
    expect(functions.map((e) => e.label)).toEqual(MNEMONICS.map((m) => m.code))
    for (const m of MNEMONICS) {
      const entry = functions.find((e) => e.label === m.code)
      expect(entry?.detail, m.code).toBe(m.screen)
      expect(entry?.act, m.code).toEqual(m.accepts.length === 0 ? { kind: 'run', line: m.code } : { kind: 'fill', line: `${m.code} ` })
    }
  })

  it('has one word entry per chrome word, filling the line', () => {
    const words = entries.filter((e) => e.group === 'word')
    expect(words.map((e) => e.label)).toEqual(Object.keys(CHROME_WORDS))
    for (const word of words) {
      expect(word.act).toEqual({ kind: 'fill', line: `${word.label} ` })
      expect(word.detail).toBe(`${SEARCH.groups.word}: ${CHROME_WORDS[word.label as keyof typeof CHROME_WORDS]}`)
    }
  })

  it('has one instrument entry per contract root, opening that instrument as a context', () => {
    const instruments = entries.filter((e) => e.group === 'instrument')
    expect(instruments.map((e) => e.label).sort()).toEqual(Object.keys(CONTRACT_NAMES).sort())
    for (const entry of instruments) {
      expect(entry.detail).toBe(`${SEARCH.groups.instrument}: ${CONTRACT_NAMES[entry.label]}`)
      expect(entry.act).toEqual({ kind: 'context', context: { kind: 'instrument', value: entry.label } })
    }
  })

  it('has one help entry per help topic, opening <code> HELP, and every help line parses to that topic', () => {
    const help = entries.filter((e) => e.group === 'help')
    expect(help.map((e) => e.code).sort()).toEqual(Object.keys(HELP_TOPICS).sort())
    for (const entry of help) {
      // The label is the line that choosing it runs, so it never reads like the function of the same code.
      expect(entry.label).toBe(`${entry.code} HELP`)
      expect(entry.act).toEqual({ kind: 'run', line: entry.label })
      const parsed = parseLine(entry.label, { index: null })
      expect(parsed.ok && parsed.action, entry.label).toMatchObject({ kind: 'help', code: entry.code })
      expect(entry.prose.length, entry.label).toBeGreaterThan(0)
    }
  })

  it('indexes every root and every help code (nothing added to the registry is missed)', () => {
    for (const m of MNEMONICS) {
      expect(entries.some((e) => e.group === 'function' && e.label === m.code), m.code).toBe(true)
      expect(entries.some((e) => e.group === 'help' && e.code === m.code), `help ${m.code}`).toBe(true)
    }
    for (const root of Object.keys(CONTRACT_NAMES)) expect(entries.some((e) => e.group === 'instrument' && e.label === root), root).toBe(true)
  })

  it('has a metric entry per METRIC_ENTRIES row, naming id, label and screen', () => {
    const metrics = entries.filter((e) => e.group === 'metric')
    expect(metrics).toHaveLength(METRIC_ENTRIES.length)
    for (const [i, row] of METRIC_ENTRIES.entries()) {
      const entry = metrics[i]
      expect(entry?.label).toBe(row.code)
      expect(entry?.act).toEqual({ kind: 'run', line: row.code })
      expect(entry?.detail).toMatch(new RegExp(`^${SEARCH.groups.metric}: .+ \\(${row.id}\\), .+`))
    }
  })

  it('never says a screen is not built yet', () => {
    for (const entry of entries) expect(entry.detail, entry.label).not.toMatch(/not built yet/i)
  })
})

describe('METRIC_ENTRIES', () => {
  it('has unique catalogue-shaped ids, each a row of docs/ANALYTICS_CATALOG.md', () => {
    const ids = METRIC_ENTRIES.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id, id).toMatch(/^[A-Z]{2}\d{1,2}$/)
      expect(analyticsCatalogue, id).toMatch(new RegExp(`^\\| ${id} \\|`, 'm'))
    }
  })

  it('only names built mnemonics', () => {
    for (const row of METRIC_ENTRIES) {
      expect(MNEMONICS.some((m) => m.code === row.code), `${row.id} ${row.code}`).toBe(true)
      expect(isBuilt(row.code), `${row.id} ${row.code}`).toBe(true)
    }
  })

  it('has a label for every row and no duplicate label', () => {
    const labels = METRIC_ENTRIES.map((m) => m.label)
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(2)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('places each metric on the screen whose code shows its card (confirmed in the screen code)', () => {
    const placement = Object.fromEntries(METRIC_ENTRIES.map((m) => [m.id, m.code]))
    expect(placement).toEqual({
      PF1: 'EQ', PF2: 'EQ', PF3: 'EQ', PF4: 'EQ', PF5: 'EQ', PF6: 'EQ',
      PF7: 'RET', PF8: 'RET', PF9: 'RET', PF10: 'RET',
      DD1: 'DD', DD2: 'DD',
      RL1: 'RR', RL2: 'RR', RL3: 'RR', RL4: 'RR', RL5: 'BLK',
      RD1: 'RET', RD2: 'MRET', RD3: 'RET', RD4: 'RET',
      RK1: 'RET', RK2: 'RET', RK3: 'RET', RK5: 'RET',
      BR1: 'EQ', BR2: 'EQ', BR3: 'RR', BR4: 'RR', RG1: 'RR',
      SV1: 'EQ', SV2: 'EQ', SV3: 'MT', SV4: 'MT', SV5: 'EQ', SV6: 'EQ', SV7: 'RET', SV9: 'MT',
      // A run's trade, path and slippage cards sit under the tear sheet tabs (RunBooks), not on RUN.
      TA1: 'EQ', TA2: 'EQ', TA3: 'EQ', TA4: 'EQ', TA5: 'EQ', TA6: 'EQ',
      EX1: 'EXPO', EX2: 'EXPO', EX3: 'COST', EX4: 'COST',
      MV1: 'GP', MV2: 'ROLL', MV3: 'GP', MV4: 'MON', MV5: 'CORR', MV7: 'SEAS', MV8: 'EVT', MV9: 'VCONE', MV10: 'ROLL',
      RI1: 'REG', RI2: 'OOS', RI3: 'LEDG', RI4: 'DQ', RI5: 'DQ',
      LV1: 'JRNL', LV2: 'LIVE', LV3: 'LIVE', LV4: 'JRNL', LV5: 'LIVE', LV6: 'LIVE',
    })
  })

  it('finds SV9 (power and minimum detectable Sharpe) on MT, first for its id, and by its wording', () => {
    const first = hits('SV9')[0]
    expect(first).toMatchObject({ rank: 1, entry: { group: 'metric', label: 'MT', act: { kind: 'run', line: 'MT' } } })
    expect(first?.entry.detail).toContain('(SV9)')
    for (const query of ['minimum detectable', 'power', 'mde']) {
      expect(hits(query).some((h) => h.entry.group === 'metric' && h.entry.detail.includes('(SV9)')), query).toBe(true)
    }
  })

  it('finds every metric by its own id, first', () => {
    for (const row of METRIC_ENTRIES) {
      const first = hits(row.id)[0]
      expect(first, row.id).toMatchObject({ rank: 1, entry: { group: 'metric', label: row.code } })
      expect(first?.entry.detail, row.id).toContain(`(${row.id})`)
    }
  })

  it('finds every metric by its own label', () => {
    for (const row of METRIC_ENTRIES) {
      expect(hits(row.label).some((h) => h.entry.group === 'metric' && h.entry.detail.includes(`(${row.id})`)), row.id).toBe(true)
    }
  })
})
