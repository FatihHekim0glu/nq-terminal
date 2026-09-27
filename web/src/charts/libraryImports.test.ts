// The chart libraries stay out of the shell (TASKS Phase 5): application code reaches uPlot,
// lightweight-charts and ECharts only through the lazy loaders in lazy.ts, and ECharts only through
// its tree-shaken entry points; the grid libraries only from src/grids. Type-only imports are fine (erased). Note that with
// verbatimModuleSyntax, `import { type X } from 'lib'` is NOT type-only: it keeps `import {} from
// 'lib'`, a static import, so it is flagged; write `import type { X } from 'lib'`.
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/**/*.d.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const LIBRARY = /^(uplot|lightweight-charts|echarts)(\/.*)?$/
/** Files allowed a runtime import of a chart library. */
const LOADERS: Readonly<Record<string, RegExp>> = {
  '/src/charts/lazy.ts': /^(uplot|lightweight-charts)$/,
  '/src/charts/echarts/core.ts': /^echarts\/(core|charts|components|renderers|features)$/,
}

/** Module specifiers a file loads at run time (static, side-effect, re-export and dynamic imports). */
export function runtimeSpecifiers(text: string): string[] {
  const noTypes = text
    .replace(/^\s*(import|export)\s+type\s[\s\S]*?\bfrom\s*['"][^'"]+['"]/gm, '')
    .replace(/typeof\s+import\(\s*['"][^'"]+['"]\s*\)/g, '')
  const found = noTypes.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)['"]([^'"]+)['"]/gm)
  return [...found].map((m) => m[1] ?? '')
}

/**
 * The grid libraries (TanStack Table and Virtual) are hooks, so they cannot go through a lazy loader;
 * only the grid components under src/grids may import them, and screens reach those lazily.
 */
const GRID_LIBRARY = /^@tanstack\/(react-table|table-core|react-virtual|virtual-core)(\/.*)?$/
const GRID_DIR = '/src/grids/'

export function libraryImportViolations(file: string, text: string): string[] {
  const specs = runtimeSpecifiers(text)
  const charts = specs
    .filter((spec) => LIBRARY.test(spec) && !spec.endsWith('.css'))
    .filter((spec) => !(LOADERS[file]?.test(spec) ?? false))
  const grids = file.startsWith(GRID_DIR) ? [] : specs.filter((spec) => GRID_LIBRARY.test(spec))
  return [...charts, ...grids].map((spec) => `${file} imports '${spec}' at run time`)
}

describe('chart library imports', () => {
  it('reads the application sources', () => {
    expect(Object.keys(SOURCES)).toContain('/src/charts/lazy.ts')
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
  })

  it('load a chart library only in the lazy loaders, and ECharts only tree-shaken', () => {
    const violations = Object.entries(SOURCES).flatMap(([file, text]) => libraryImportViolations(file, text))
    expect(violations).toEqual([])
  })
})

describe('born-failing cases (rule 5)', () => {
  it('flags a static, a side-effect, a re-export and a dynamic import outside the loaders', () => {
    const bad = [
      "import uPlot from 'uplot'",
      "import 'lightweight-charts'",
      "export { init } from 'echarts/core'",
      "const m = await import('echarts/core')",
      "import { type IChartApi } from 'lightweight-charts'",
    ].join('\n')
    expect(libraryImportViolations('/src/charts/LineStack.tsx', bad)).toHaveLength(5)
  })

  it('flags a grid library imported outside src/grids, and allows it inside', () => {
    const grid = "import { useVirtualizer } from '@tanstack/react-virtual'\nimport { createTable } from '@tanstack/react-table'"
    expect(libraryImportViolations('/src/chrome/Workspace.tsx', grid)).toHaveLength(2)
    expect(libraryImportViolations('/src/grids/MonitorGrid.window.ts', grid)).toEqual([])
  })

  it('flags the bare echarts package even in the ECharts core file', () => {
    expect(libraryImportViolations('/src/charts/echarts/core.ts', "import * as echarts from 'echarts'")).toHaveLength(1)
  })

  it('allows type-only imports, type queries and the uPlot stylesheet', () => {
    const ok = [
      "import type uPlot from 'uplot'",
      'import type {\n  IChartApi,\n  ISeriesApi,\n} from \'lightweight-charts\'',
      "export type EchartsModule = typeof import('echarts/core')",
      "import 'uplot/dist/uPlot.min.css'",
    ].join('\n')
    expect(libraryImportViolations('/src/charts/LineStack.tsx', ok)).toEqual([])
  })
})
