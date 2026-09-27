// Test helpers for the ECharts set (imported by *.test.ts files only, never by a component).
// uniqueTokens() gives every chart colour a distinct value that no default token has, so a test can
// prove that each colour in an option came from the tokens and not from a literal in the code.
import { CHART_TOKENS, DEFAULT_CHART_TOKENS, type ChartColorKey, type ChartColors, type ChartTokens } from '../theme'
import { collectColours, type FoundColour } from '../theme/themeTestUtil'

export function uniqueTokens(): ChartTokens {
  const keys = Object.keys(CHART_TOKENS) as ChartColorKey[]
  const colour = (i: number) => `#${(0x1a2b3c + i * 0x020305).toString(16).toUpperCase().padStart(6, '0')}`
  const color = Object.fromEntries(keys.map((k, i) => [k, colour(i)])) as ChartColors
  return { color, font: DEFAULT_CHART_TOKENS.font }
}

export function tokenValues(tokens: ChartTokens): Set<string> {
  return new Set(Object.values(tokens.color))
}

/** Colours in `value` that are not in `allowed`, with their paths. */
export function strayColours(value: unknown, allowed: ReadonlySet<string>): FoundColour[] {
  return collectColours(value).filter((c) => !allowed.has(c.value))
}

interface FakeApi {
  coord(v: readonly unknown[]): number[]
  size(v: readonly unknown[]): number[]
  value(dim: number): unknown
}

/** A stand-in for the custom series API: 10px per unit on both axes, category bands 10px wide. */
export function fakeApi(item: readonly unknown[] = []): FakeApi {
  const num = (x: unknown) => (typeof x === 'number' ? x : 0)
  return {
    coord: (v) => [num(v[0]) * 10, num(v[1]) * 10],
    size: () => [10, 10],
    value: (dim) => item[dim],
  }
}

interface FakeParams {
  dataIndex: number
  coordSys: { type: string; x: number; y: number; width: number; height: number }
}
type RenderItem = (params: FakeParams, api: FakeApi) => unknown

/** The plot rectangle the fake renderItem params report. */
export const FAKE_PLOT = { type: 'cartesian2d', x: 0, y: 0, width: 400, height: 300 } as const

/** Runs a custom series' renderItem for every data index and returns what it drew. */
export function renderCustom(series: unknown, count: number): unknown[] {
  const s = series as { renderItem: RenderItem; data: readonly (readonly unknown[])[] }
  return Array.from({ length: count }, (_, i) => s.renderItem({ dataIndex: i, coordSys: { ...FAKE_PLOT } }, fakeApi(s.data[i] ?? [])))
}

/** The option's series as a plain array. */
export function seriesOf(option: unknown): Record<string, unknown>[] {
  const s = (option as { series?: unknown }).series
  return (Array.isArray(s) ? s : [s]) as Record<string, unknown>[]
}
