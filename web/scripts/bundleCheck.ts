// Bundle check (TASKS Phase 5 stage A), run after every production build (`pnpm build`) and by
// scripts/bundleCheck.test.ts on real builds:
//   1. the shell (index.html's script, its preloads and their static imports) stays under a gzip budget;
//   2. no chart or grid library code is in the shell: each loads later through a dynamic import;
//   3. each library's code sits in exactly one chunk, named after its group in vite.config.ts;
//   4. each library chunk stays under its gzip budget (ECharts must stay tree-shaken);
//   5. a production build holds no gallery code at all (a gallery build must hold it);
//   6. React's code sits in the react chunk, so no library chunk is needed to boot the shell.
// Library code is found by strings only the library itself contains.
// Usage: node scripts/bundleCheck.ts <dist dir> [--gallery]
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

export const BUNDLE_BUDGET = {
  /** The shell was 120.4 kB gzip before Phase 5 (index, vendor, react and the runtime). */
  shellGzip: 135_000,
  libraryGzip: {
    uplot: 30_000,
    'lightweight-charts': 75_000,
    /** Tree-shaken to the five chart types in src/charts/echarts/core.ts: about 206 kB. The full package is far larger. */
    echarts: 230_000,
    'tanstack-grid': 45_000,
  },
} as const

export type LibraryName = keyof typeof BUNDLE_BUDGET.libraryGzip

export const LIBRARY_MARKERS: Readonly<Record<LibraryName, readonly string[]>> = {
  uplot: ['u-cursor-x'],
  'lightweight-charts': ['tv-lightweight-charts'],
  echarts: ['__ec_inner'],
  'tanstack-grid': ['coreRowModelsFeature', 'getVirtualIndexes'],
}

/** React's own code; it belongs in the react-*.js vendor chunk only (vite.config.ts CHUNK_GROUPS). */
export const REACT_MARKER = 'react.transitional.element'

export const GALLERY_MARKERS: readonly string[] = ['__gallery', 'data-gallery-state', 'nqt-gallery']

export interface BundleReport {
  /** JS files that load with the page, before any dynamic import. */
  readonly initial: readonly string[]
  readonly shellGzip: number
  /** For each library, the JS files holding its code. */
  readonly libraries: Readonly<Partial<Record<LibraryName, readonly string[]>>>
  readonly libraryGzip: Readonly<Partial<Record<LibraryName, number>>>
  readonly galleryFiles: readonly string[]
  readonly violations: readonly string[]
}

const gzipSize = (text: string) => gzipSync(Buffer.from(text, 'utf-8'), { level: 9 }).length

function entryFiles(html: string): string[] {
  const found = html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*\brel="modulepreload"[^>]*\bhref)="\/assets\/([^"]+\.js)"/g)
  return [...found].map((m) => m[1] ?? '')
}

/** Static imports and re-exports of sibling chunks (`import"./x.js"`, `from"./x.js"`), not import(). */
function staticImports(js: string): string[] {
  return [...js.matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g)].map((m) => m[1] ?? '')
}

function initialGraph(read: (file: string) => string, roots: readonly string[]): string[] {
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const file = queue.shift() ?? ''
    if (seen.has(file)) continue
    seen.add(file)
    queue.push(...staticImports(read(file)))
  }
  return [...seen]
}

function checkLibraries(js: ReadonlyMap<string, string>, initial: ReadonlySet<string>) {
  const libraries: Partial<Record<LibraryName, string[]>> = {}
  const libraryGzip: Partial<Record<LibraryName, number>> = {}
  const violations: string[] = []
  for (const [lib, markers] of Object.entries(LIBRARY_MARKERS) as [LibraryName, readonly string[]][]) {
    const files = [...js.entries()].filter(([, text]) => markers.some((m) => text.includes(m))).map(([f]) => f)
    if (files.length === 0) continue
    libraries[lib] = files
    for (const f of files) {
      if (initial.has(f)) violations.push(`${lib} code loads with the shell (${f}); load it through src/charts/lazy.ts`)
      if (!f.startsWith(`${lib}-`)) violations.push(`${lib} code is in ${f}, outside its own ${lib}-*.js chunk`)
    }
    if (files.length > 1) violations.push(`${lib} code is split over ${files.join(', ')}`)
    const size = files.reduce((sum, f) => sum + gzipSize(js.get(f) ?? ''), 0)
    libraryGzip[lib] = size
    const budget = BUNDLE_BUDGET.libraryGzip[lib]
    if (size > budget) violations.push(`${lib} chunk is ${size} bytes gzip, over its ${budget} budget`)
  }
  return { libraries, libraryGzip, violations }
}

export function analyseBundle(distDir: string, opts: { readonly gallery: boolean }): BundleReport {
  const assets = path.join(distDir, 'assets')
  const names = readdirSync(assets)
  const text = new Map(names.filter((n) => /\.(js|css)$/.test(n)).map((n) => [n, readFileSync(path.join(assets, n), 'utf-8')]))
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf-8')
  const js = new Map([...text].filter(([n]) => n.endsWith('.js')))
  const initial = initialGraph((f) => js.get(f) ?? '', entryFiles(html))
  const shellGzip = initial.reduce((sum, f) => sum + gzipSize(js.get(f) ?? ''), 0)
  const libs = checkLibraries(js, new Set(initial))
  const galleryFiles = [...text.entries(), ['index.html', html] as const]
    .filter(([, t]) => GALLERY_MARKERS.some((m) => t.includes(m)))
    .map(([f]) => f)
  const violations = [...libs.violations]
  for (const [f, t] of js) {
    if (t.includes(REACT_MARKER) && !f.startsWith('react-')) violations.push(`react code is in ${f}, outside its own react-*.js chunk`)
  }
  if (shellGzip > BUNDLE_BUDGET.shellGzip) violations.push(`shell JS is ${shellGzip} bytes gzip, over its ${BUNDLE_BUDGET.shellGzip} budget`)
  if (!opts.gallery && galleryFiles.length > 0) violations.push(`production bundle holds gallery code: ${galleryFiles.join(', ')}`)
  if (opts.gallery && galleryFiles.length === 0) violations.push('gallery build holds no gallery code')
  return { initial, shellGzip, libraries: libs.libraries, libraryGzip: libs.libraryGzip, galleryFiles, violations }
}

function main(argv: readonly string[]): number {
  const dir = argv[0]
  if (dir === undefined) {
    process.stderr.write('usage: node scripts/bundleCheck.ts <dist dir> [--gallery]\n')
    return 2
  }
  const report = analyseBundle(path.resolve(dir), { gallery: argv.includes('--gallery') })
  const kb = (n: number) => `${(n / 1000).toFixed(1)} kB`
  process.stdout.write(`bundle check: shell ${kb(report.shellGzip)} gzip of ${kb(BUNDLE_BUDGET.shellGzip)} (${report.initial.join(', ')})\n`)
  for (const [lib, size] of Object.entries(report.libraryGzip)) {
    process.stdout.write(`bundle check: ${lib} ${kb(size)} gzip of ${kb(BUNDLE_BUDGET.libraryGzip[lib as LibraryName])}\n`)
  }
  for (const v of report.violations) process.stderr.write(`bundle check FAILED: ${v}\n`)
  return report.violations.length === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
