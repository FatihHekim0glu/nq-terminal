import { describe, expect, it } from 'vitest'
import { CHROME, FRAME_STRIP, STATUS_BAR } from '../../copy/chrome'
import { FENCE } from '../../copy/lineStack'
import {
  GRAB_MAX_CANVAS,
  GRAB_METRICS,
  grabCaption,
  grabFileName,
  grabLayout,
  grabScale,
  grabWidth,
  wrapLine,
  type GrabFacts,
  type GrabProvenance,
} from './grabModel'

const NOW = new Date('2026-09-28T18:02:11Z') // 14:02:11 in New York (summer time)
const AS_OF = '2026-09-28T17:59:30Z' // 13:59:30 in New York
const SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

const FULL: GrabProvenance = {
  tags: ['[PRE-REG]', '[POST HOC]'],
  basis: 'Basis net: after costs',
  unit: 'ticks',
  window: '2010-01-01..2021-12-31',
  n: 3021,
  source: '/api/analytics?run=nt_x',
  specSha: SHA,
}

const NONE: GrabProvenance = { tags: [], basis: null, unit: null, window: null, n: null, source: null, specSha: null }

function facts(over: Partial<GrabFacts> = {}): GrabFacts {
  return {
    panelLabel: '1-EQ',
    title: 'volmanaged_v0 EQ',
    group: 'A',
    demo: false,
    fixture: false,
    provenance: null,
    asOfUtc: null,
    now: NOW,
    ...over,
  }
}

describe('grabCaption', () => {
  it('writes three lines for a panel with provenance: panel, provenance, fence and source', () => {
    const lines = grabCaption(facts({ demo: true, fixture: true, provenance: FULL, asOfUtc: AS_OF }))
    expect(lines).toEqual([
      '1-EQ [A] | volmanaged_v0 EQ | DEMO DATA',
      '[PRE-REG] [POST HOC] | Basis net: after costs | ticks | 2010-01-01..2021-12-31, n 3021 | spec 0123456789ab',
      `${FENCE.label} | GET /api/analytics?run=nt_x | as of 13:59:30 ET | grabbed 14:02:11 ET | ${CHROME.appTitle}`,
    ])
  })

  it('uses the copy module for the flags, so the words are not repeated here', () => {
    const [demo] = grabCaption(facts({ demo: true }))
    expect(demo).toContain(FRAME_STRIP.demoData)
    const [fixture] = grabCaption(facts({ fixture: true }))
    expect(fixture).toContain(STATUS_BAR.fixture)
  })

  // The screen shows one term in the demo (the frame strip flag and the status segment: DEMO DATA), and so does the image.
  it('prints the one demo term in the demo, even when the backend health answer also says fixture', () => {
    const [first] = grabCaption(facts({ demo: true, fixture: true }))
    expect(first).toContain(FRAME_STRIP.demoData)
    expect(first).not.toContain(STATUS_BAR.fixture)
  })

  it('keeps FIXTURE DATA for fixture data outside the demo, and prints neither flag for a live answer', () => {
    expect(grabCaption(facts({ fixture: true }))[0]).toBe('1-EQ [A] | volmanaged_v0 EQ | FIXTURE DATA')
    expect(grabCaption(facts())[0]).toBe('1-EQ [A] | volmanaged_v0 EQ')
  })

  it('writes two lines when there is no provenance: the panel line and the fence line', () => {
    const lines = grabCaption(facts())
    expect(lines).toEqual([
      '1-EQ [A] | volmanaged_v0 EQ',
      `${FENCE.label} | grabbed 14:02:11 ET | ${CHROME.appTitle}`,
    ])
  })

  it('writes two lines when the provenance carries no field for the middle line (the source goes on the last line)', () => {
    const lines = grabCaption(facts({ provenance: { ...NONE, source: '/api/health' } }))
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe(`${FENCE.label} | GET /api/health | grabbed 14:02:11 ET | ${CHROME.appTitle}`)
  })

  it.each<[string, Partial<GrabProvenance>, string]>([
    ['tags only', { tags: ['[POST HOC]'] }, '[POST HOC]'],
    ['basis only', { basis: 'Basis net: after costs' }, 'Basis net: after costs'],
    ['unit only', { unit: 'ticks' }, 'ticks'],
    ['window only', { window: '2010-01-01..2021-12-31' }, '2010-01-01..2021-12-31'],
    ['n only', { n: 12 }, 'n 12'],
    ['window and n share a field', { window: '2010-01-01..2021-12-31', n: 12 }, '2010-01-01..2021-12-31, n 12'],
    ['spec only', { specSha: 'abc123' }, 'spec abc123'],
    ['zero sessions is a number, not a gap', { n: 0 }, 'n 0'],
  ])('partial provenance, %s: the middle line holds just that field', (_name, part, expected) => {
    const lines = grabCaption(facts({ provenance: { ...NONE, ...part } }))
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe(expected)
  })

  it('keeps the first 12 characters of the spec hash', () => {
    const lines = grabCaption(facts({ provenance: { ...NONE, specSha: SHA } }))
    expect(lines[1]).toBe('spec 0123456789ab')
    expect(lines.join('\n')).not.toContain(SHA.slice(0, 13))
  })

  it.each(['-', ''])('leaves out the group chip for the group %j', (group) => {
    const [first] = grabCaption(facts({ group }))
    expect(first).toBe('1-EQ | volmanaged_v0 EQ')
  })

  it('leaves out the flags when the data is neither demo nor fixture', () => {
    const [first] = grabCaption(facts({ demo: false, fixture: false }))
    expect(first).not.toContain(FRAME_STRIP.demoData)
    expect(first).not.toContain(STATUS_BAR.fixture)
  })

  it('starts with the title when the panel has no number and no code', () => {
    const [first] = grabCaption(facts({ panelLabel: '', group: '-' }))
    expect(first).toBe('volmanaged_v0 EQ')
  })

  it('never writes the text null, undefined, NaN or Invalid, whatever is missing', () => {
    const text = grabCaption(
      facts({
        panelLabel: '',
        title: '',
        group: '-',
        asOfUtc: 'not a date',
        provenance: { tags: [], basis: null, unit: null, window: null, n: Number.NaN, source: null, specSha: null },
      }),
    ).join('\n')
    for (const bad of ['null', 'undefined', 'NaN', 'Invalid']) expect(text).not.toContain(bad)
  })

  it('drops empty and blank provenance fields instead of writing empty slots', () => {
    const lines = grabCaption(
      facts({ provenance: { ...NONE, tags: ['', '  ', '[POST HOC]'], basis: '  ', unit: '', window: ' ', specSha: '' } }),
    )
    expect(lines[1]).toBe('[POST HOC]')
  })

  it('drops the as of time when the server time is unreadable, and keeps the grabbed time', () => {
    const last = grabCaption(facts({ asOfUtc: 'garbage' })).at(-1)
    expect(last).toBe(`${FENCE.label} | grabbed 14:02:11 ET | ${CHROME.appTitle}`)
  })

  it('leaves out the grabbed time rather than throwing when the clock is invalid', () => {
    const last = grabCaption(facts({ now: new Date(Number.NaN) })).at(-1)
    expect(last).toBe(`${FENCE.label} | ${CHROME.appTitle}`)
  })
})

describe('grabFileName', () => {
  it('names the file after the title and the UTC time', () => {
    expect(grabFileName('volmanaged_v0 EQ', NOW)).toBe('volmanaged_v0_EQ_20260928-180211Z.png')
  })

  it('uses UTC, not the local zone, and pads every field', () => {
    expect(grabFileName('GP', new Date('2026-01-02T03:04:05Z'))).toBe('GP_20260102-030405Z.png')
  })

  it('turns runs of other characters into one underscore', () => {
    expect(grabFileName('NQ  GP / 1d', NOW)).toBe('NQ_GP_1d_20260928-180211Z.png')
    expect(grabFileName('a.b-c_d', NOW)).toBe('a.b-c_d_20260928-180211Z.png')
  })

  it('never lets the title climb out of the downloads folder or hide the file', () => {
    const name = grabFileName('../../etc/passwd', NOW)
    expect(name).not.toContain('/')
    expect(name.startsWith('.')).toBe(false)
  })

  it.each(['', '   ', '???', '..'])('falls back to panel for the title %j', (title) => {
    expect(grabFileName(title, NOW)).toBe('panel_20260928-180211Z.png')
  })
})

describe('wrapLine', () => {
  const chars = (s: string): number => Array.from(s).length

  it('returns the text as one line when it fits', () => {
    expect(wrapLine('abc def', 20, chars)).toEqual(['abc def'])
  })

  it('breaks at spaces, filling each line greedily', () => {
    expect(wrapLine('aaa bbb ccc', 7, chars)).toEqual(['aaa bbb', 'ccc'])
    expect(wrapLine('aaa bbb ccc', 6, chars)).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('breaks a word that is wider than the line by characters', () => {
    expect(wrapLine('abcdefghij', 4, chars)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapLine('ab cdefghij', 4, chars)).toEqual(['ab', 'cdef', 'ghij'])
  })

  it('collapses runs of white space and returns nothing for blank text', () => {
    expect(wrapLine('  aaa \n  bbb\t', 20, chars)).toEqual(['aaa bbb'])
    expect(wrapLine('', 20, chars)).toEqual([])
    expect(wrapLine('   ', 20, chars)).toEqual([])
  })

  it('keeps every line within the width the measure allows', () => {
    const text = 'the quick brown fox jumps over the lazy dog and keeps running'
    const lines = wrapLine(text, 12, chars)
    for (const line of lines) expect(chars(line)).toBeLessThanOrEqual(12)
    expect(lines.join(' ')).toBe(text)
  })

  it('never splits a character made of two code units', () => {
    expect(wrapLine('a\u{1F600}b\u{1F600}', 2, chars)).toEqual(['a\u{1F600}', 'b\u{1F600}'])
  })

  it('makes progress, one character a line, when not even one character fits', () => {
    expect(wrapLine('abc', 0, chars)).toEqual(['a', 'b', 'c'])
  })

  it('measures with the callers measure, so proportional fonts wrap correctly', () => {
    const wide = (s: string): number => Array.from(s).reduce((sum, c) => sum + (c === 'W' ? 3 : 1), 0)
    expect(wrapLine('WW WW', 9, wide)).toEqual(['WW', 'WW'])
    expect(wrapLine('WW ww', 9, wide)).toEqual(['WW ww'])
  })
})

describe('grabLayout', () => {
  const M = { pad: 10, lineHeight: 20, minWidth: 100, maxHeight: 1000 }

  it('pins the house metrics', () => {
    expect(GRAB_METRICS).toEqual({ pad: 8, lineHeight: 16, minWidth: 640, maxHeight: 8000 })
  })

  it('stacks the figures in the order given, each under its summary lines, then the rule and the caption', () => {
    const layout = grabLayout([{ width: 300, height: 200 }, { width: 250, height: 100 }], [1, 0], 2, M)
    expect(layout.width).toBe(320)
    expect(layout.placements).toEqual([
      { index: 0, x: 10, summaryY: 10, y: 30 },
      { index: 1, x: 10, summaryY: 240, y: 240 },
    ])
    expect(layout.ruleY).toBe(350)
    expect(layout.captionY).toBe(361)
    expect(layout.height).toBe(411)
    expect(layout.kept).toBe(2)
    expect(layout.trimmed).toBe(false)
  })

  it('is at least the minimum width wide and holds the widest figure with its padding', () => {
    expect(grabLayout([{ width: 20, height: 10 }], [0], 1, M).width).toBe(100)
    expect(grabLayout([{ width: 20, height: 10 }, { width: 500, height: 10 }], [0, 0], 1, M).width).toBe(520)
  })

  it('drops a figure that would pass the maximum height', () => {
    const layout = grabLayout([{ width: 300, height: 200 }, { width: 250, height: 100 }], [1, 0], 2, { ...M, maxHeight: 400 })
    expect(layout.kept).toBe(1)
    expect(layout.trimmed).toBe(true)
    expect(layout.placements.map((p) => p.index)).toEqual([0])
    expect(layout.ruleY).toBe(240)
    expect(layout.height).toBe(301)
  })

  it('drops every figure after the first one that does not fit, even a small one', () => {
    const boxes = [{ width: 300, height: 200 }, { width: 300, height: 900 }, { width: 300, height: 20 }]
    const layout = grabLayout(boxes, [0, 0, 0], 1, { ...M, maxHeight: 500 })
    expect(layout.placements.map((p) => p.index)).toEqual([0])
    expect(layout.trimmed).toBe(true)
  })

  it('counts the caption when deciding what fits: the image never passes the maximum unless one figure alone does', () => {
    const boxes = [{ width: 300, height: 100 }, { width: 300, height: 100 }, { width: 300, height: 100 }]
    for (const maxHeight of [200, 260, 300, 400, 1000]) {
      const layout = grabLayout(boxes, [0, 0, 0], 3, { ...M, maxHeight })
      expect(layout.height).toBeLessThanOrEqual(Math.max(maxHeight, grabLayout(boxes.slice(0, 1), [0], 3, M).height))
    }
  })

  it('always keeps the first figure, even one taller than the maximum (the scale cap handles it)', () => {
    const layout = grabLayout([{ width: 300, height: 5000 }], [0], 1, M)
    expect(layout.kept).toBe(1)
    expect(layout.trimmed).toBe(false)
    expect(layout.height).toBeGreaterThan(M.maxHeight)
  })

  it('lays out a caption alone when there are no figures', () => {
    const layout = grabLayout([], [], 3, M)
    expect(layout.kept).toBe(0)
    expect(layout.placements).toEqual([])
    expect(layout.trimmed).toBe(false)
    expect(layout.width).toBe(100)
    expect(layout.height).toBe(layout.captionY + 60 + 10)
  })

  it('gives the width the text is wrapped to: the layout width, whatever is later left out', () => {
    const boxes = [{ width: 300, height: 200 }, { width: 500, height: 900 }]
    expect(grabWidth(boxes, M)).toBe(520)
    expect(grabLayout(boxes, [0, 0], 1, { ...M, maxHeight: 400 }).width).toBe(520)
    expect(grabWidth([], M)).toBe(100)
  })

  it('treats a missing summary count as no summary lines', () => {
    const layout = grabLayout([{ width: 300, height: 100 }], [], 1, M)
    expect(layout.placements[0]).toEqual({ index: 0, x: 10, summaryY: 10, y: 10 })
  })
})

describe('grabScale', () => {
  it('follows the device pixel ratio, never below 1', () => {
    expect(grabScale(2, 800, 600)).toBe(2)
    expect(grabScale(1.5, 800, 600)).toBe(1.5)
    expect(grabScale(0.5, 800, 600)).toBe(1)
    expect(grabScale(Number.NaN, 800, 600)).toBe(1)
  })

  it('caps the canvas at 16000 px on each side', () => {
    expect(GRAB_MAX_CANVAS).toBe(16000)
    expect(grabScale(3, 8000, 100)).toBe(2)
    expect(grabScale(4, 100, 8000)).toBe(2)
    expect(grabScale(4, 5000, 9000)).toBe(16000 / 9000)
  })

  it('may go below 1 when the image alone is wider than the cap', () => {
    expect(grabScale(2, 20000, 100)).toBe(0.8)
  })

  it('stays finite for a zero-sized image', () => {
    expect(grabScale(2, 0, 0)).toBe(2)
  })
})
