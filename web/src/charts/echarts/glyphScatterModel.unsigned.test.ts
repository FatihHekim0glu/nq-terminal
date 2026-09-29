// GlyphAxis.signed: a linear axis writes a positive value with an explicit plus by default (a change, a Sharpe).
// A duration or a count (the effect map's years) sets `signed: false` and reads "10.66", not "+10.66", in the
// accessible summary and in the table view.
import { describe, expect, it } from 'vitest'
import { describeGlyphScatter, glyphScatterTable, type GlyphAxis, type GlyphScatterInput } from './glyphScatterModel'

const SHARPE: GlyphAxis = { label: 'Sharpe', scale: 'linear', format: 'number' }

function input(x: GlyphAxis): GlyphScatterInput {
  return {
    name: 'Track',
    x,
    y: SHARPE,
    points: [
      { label: 'long_v0', tag: '1', x: 10.66, y: 0.99, glyph: 'up', kind: 'PASS' },
      { label: 'short_v0', tag: '2', x: 9.99, y: -0.4, glyph: 'down', kind: 'FAIL' },
    ],
  }
}

const UNSIGNED: GlyphAxis = { label: 'Years', scale: 'linear', format: 'number', signed: false }
const SIGNED: GlyphAxis = { label: 'Years', scale: 'linear', format: 'number' }

const xCell = (i: GlyphScatterInput, row: number): string => glyphScatterTable(i).rows[row]!.x as string

describe('glyphScatterModel: signed: false on a linear axis', () => {
  it('writes the table x cells with no plus', () => {
    const i = input(UNSIGNED)
    expect(xCell(i, 0)).toBe('10.66')
    expect(xCell(i, 1)).toBe('9.99')
  })

  it('writes the summary x range with no plus before the x values', () => {
    const text = describeGlyphScatter(input(UNSIGNED))
    expect(text).toContain('Years from 9.99 to 10.66')
    expect(text).not.toContain('+10.66')
    expect(text).not.toContain('+9.99')
  })

  it('leaves the y axis, which did not ask, signed', () => {
    const text = describeGlyphScatter(input(UNSIGNED))
    expect(text).toContain('Sharpe from -0.40 to +0.99')
    expect(glyphScatterTable(input(UNSIGNED)).rows[0]!.y).toBe('+0.99')
  })

  it('keeps a negative value with its minus sign', () => {
    const i: GlyphScatterInput = { ...input(UNSIGNED), points: [{ label: 'n', tag: '1', x: -2.5, y: 1, glyph: 'ring', kind: 'x' }] }
    expect(xCell(i, 0)).toBe('-2.50')
  })
})

describe('glyphScatterModel: the default is unchanged', () => {
  it('still writes a plus on a linear axis that does not set the flag', () => {
    const i = input(SIGNED)
    expect(xCell(i, 0)).toBe('+10.66')
    expect(describeGlyphScatter(i)).toContain('Years from +9.99 to +10.66')
  })

  it('treats signed: true like the default', () => {
    expect(xCell(input({ ...SIGNED, signed: true }), 0)).toBe('+10.66')
  })

  it('writes no plus on a log axis, flag or not', () => {
    expect(xCell(input({ ...SIGNED, scale: 'log' }), 0)).toBe('10.66')
    expect(xCell(input({ ...UNSIGNED, scale: 'log' }), 0)).toBe('10.66')
  })
})
