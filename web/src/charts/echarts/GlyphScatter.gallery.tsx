// Gallery entry /__gallery/GlyphScatter (roadmap R8 and R5): two panels from fixed fixture data.
// Left: p before against p after on reversed log axes, up and down triangles, a ring, a hollow point,
// labelled alpha lines, a dashed y = x diagonal and a point pinned at the edge in its own glyph, with its true value.
// Right: linear axes with reference lines and one point outside the fixed range.
import { useMemo } from 'react'
import { GLYPH_SCATTER as G } from '../../copy/glyphScatter'
import { fillCopy } from '../../copy/workspace'
import { GalleryPanel, GalleryPanels } from './GalleryPanels'
import { GlyphScatter } from './GlyphScatter'
import type { GlyphScatterInput, GlyphPoint, PointGlyph } from './glyphScatterModel'

const GF = G.gallery

type Row = readonly [tag: string, x: number, y: number, glyph: PointGlyph, kind: string, hollow?: boolean]

const points = (rows: readonly Row[]): GlyphPoint[] =>
  rows.map(([tag, x, y, glyph, kind, hollow]) => ({
    label: fillCopy(GF.strategy, { tag }),
    tag,
    x,
    y,
    glyph,
    kind,
    ...(hollow ? { hollow } : {}),
    extra: { n: String(40 + tag.charCodeAt(0)), note: hollow ? GF.thin : '' },
  }))

function logFixture(): GlyphScatterInput {
  return {
    name: GF.logName,
    x: { label: GF.pBefore, scale: 'log', format: 'p', inverse: true, min: 1e-4 },
    y: { label: GF.pAfter, scale: 'log', format: 'p', inverse: true },
    points: points([
      ['A', 0.0004, 0.003, 'up', GF.holds],
      ['B', 0.002, 0.0015, 'up', GF.holds, true],
      ['C', 0.008, 0.06, 'down', GF.lost],
      ['D', 0.03, 0.4, 'down', GF.lost],
      ['E', 0.2, 0.31, 'ring', GF.undecided],
      ['F', 0.0009, 0.0011, 'up', GF.holds],
      ['G', 0.00002, 0.0008, 'up', GF.holds],
      ['H', 0.5, 0.9, 'ring', GF.undecided],
    ]),
    lines: [
      { axis: 'x', value: 0.05, label: GF.alphaBefore, tone: 'data' },
      { axis: 'y', value: 0.05, label: GF.alphaAfter, tone: 'accent' },
    ],
    diagonal: GF.diagonal,
    extraColumns: [{ key: 'n', label: GF.trades, numeric: true }, { key: 'note', label: GF.note }],
  }
}

function linearFixture(): GlyphScatterInput {
  return {
    name: GF.linearName,
    x: { label: GF.sharpeIn, scale: 'linear', format: 'number' },
    y: { label: GF.sharpeOut, scale: 'linear', format: 'number', max: 2 },
    points: points([
      ['A', 1.2, 0.9, 'up', GF.beats],
      ['B', 0.9, 0.7, 'up', GF.beats],
      ['C', 1.8, 1.3, 'up', GF.beats, true],
      ['D', 1.5, -0.3, 'down', GF.trails],
      ['E', 0.8, 0.2, 'down', GF.trails],
      ['F', 1.1, -0.6, 'down', GF.trails],
      ['G', 0.3, 0.05, 'ring', GF.flat],
      ['H', -0.4, -0.2, 'ring', GF.flat],
      ['I', 2.1, 3.4, 'up', GF.beats],
    ]),
    lines: [
      { axis: 'x', value: 0, label: GF.zero, tone: 'muted' },
      { axis: 'y', value: 0, label: GF.zero, tone: 'muted' },
      { axis: 'y', value: 0.5, label: GF.hurdle, tone: 'data' },
    ],
    extraColumns: [{ key: 'n', label: GF.trades, numeric: true }, { key: 'note', label: GF.note }],
  }
}

export default function GlyphScatterGallery() {
  const log = useMemo(logFixture, [])
  const linear = useMemo(linearFixture, [])
  return (
    <GalleryPanels>
      <GalleryPanel title={GF.log}>
        <GlyphScatter data={log} chartId="glyph-log" />
      </GalleryPanel>
      <GalleryPanel title={GF.linear}>
        <GlyphScatter data={linear} chartId="glyph-linear" />
      </GalleryPanel>
    </GalleryPanels>
  )
}
