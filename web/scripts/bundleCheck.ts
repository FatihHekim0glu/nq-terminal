// Bundle check (TASKS Phase 5 stage A), run after every production build (`pnpm build`) and by
// scripts/bundleCheck.test.ts on real builds:
//   1. the shell (index.html's script, its preloads and their static imports) stays under a gzip budget;
//   2. no chart or grid library code is in the shell: each loads later through a dynamic import;
//   3. each library's code sits in exactly one chunk, named after its group in vite.config.ts;
//   4. each library chunk stays under its gzip budget (ECharts must stay tree-shaken);
//   5. a production build holds no gallery code at all (a gallery build must hold it);
//   6. React's code sits in the react chunk, so no library chunk is needed to boot the shell;
//   7. a production build holds no demo code and no fixture data (a demo build must hold both);
//   8. no build holds Radix dialog code: cmdk's Command.Dialog is unused, and vite.config.ts aliases its import
//      to a stub (src/vendor/radixDialogStub.tsx), which took about 10 kB gzip out of the shell.
// Library code is found by strings only the library itself contains.
// Usage: node scripts/bundleCheck.ts <dist dir> [--gallery | --demo]
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

export const BUNDLE_BUDGET = {
  /**
   * The shell was 120.4 kB gzip before Phase 5 (index, vendor, react and the runtime), 132.1 kB after wave 5,
   * 125.2 kB after the wave 6 shell diet (everything first paint does not need moved behind a dynamic import) and
   * 115.2 kB after shell diet 2 (wave 7), which aliased cmdk's unused Radix dialog stack to a stub (vite.config.ts,
   * rule 8 below). scripts/shellBudget.test.ts names each piece and pins this ceiling. The ceiling is that size plus
   * 1.5 kB, so a later wave cannot grow the shell back unnoticed: to grow it on purpose, move something else
   * out first, or raise this number together with PINNED_SHELL_CEILING in shellBudget.test.ts and say why.
   */
  shellGzip: 116_700,
  /**
   * The gallery build's shell (the E2E build, `--gallery`) is about 0.8 kB larger: its entry loads the API client
   * and the connection state eagerly, so those two split out of index. Measured 116.0 kB after shell diet 2, plus 1.5 kB.
   */
  galleryShellGzip: 117_600,
  libraryGzip: {
    uplot: 30_000,
    'lightweight-charts': 75_000,
    /** Tree-shaken to the five chart types in src/charts/echarts/core.ts: about 206 kB. The full package is far larger. */
    echarts: 230_000,
    'tanstack-grid': 45_000,
    /** The Perspective client, viewer and datagrid plugin (TASKS 9.1): about 88 kB. Its WebAssembly is a separate asset. */
    perspective: 100_000,
  },
} as const

export type LibraryName = keyof typeof BUNDLE_BUDGET.libraryGzip

export const LIBRARY_MARKERS: Readonly<Record<LibraryName, readonly string[]>> = {
  uplot: ['u-cursor-x'],
  'lightweight-charts': ['tv-lightweight-charts'],
  echarts: ['__ec_inner'],
  'tanstack-grid': ['coreRowModelsFeature', 'getVirtualIndexes'],
  perspective: ['PerspectiveViewerElement'],
}

/** React's own code; it belongs in the react-*.js vendor chunk only (vite.config.ts CHUNK_GROUPS). */
export const REACT_MARKER = 'react.transitional.element'

/**
 * Strings only the Radix dialog stack holds: the dialog itself and the layer, focus scope and focus guard code it
 * pulls in. None may be in any chunk (rule 8). scripts/shellBudget.test.ts checks each is still in the installed
 * Radix source, so a renamed string cannot make this rule pass by finding nothing.
 */
export const RADIX_DIALOG_MARKERS: readonly string[] = [
  'DialogContent',
  'dismissableLayer.pointerDownOutside',
  'focusScope.autoFocusOnMount',
  'data-radix-focus-guard',
]

export const GALLERY_MARKERS: readonly string[] = ['__gallery', 'data-gallery-state', 'nqt-gallery']

/**
 * The demo boot's marker (src/demo/boot.tsx), and a run id found only in the fixture captures the demo
 * serves (runs, tear and home fixtures; absent from the production dist when this rule was added). The
 * captures say "test files only": the demo chunk is the one place outside tests allowed to hold them.
 */
export const DEMO_MARKERS: readonly string[] = ['nqt-demo', 'nt_volmanaged_v0_fixture_m1']

export interface BundleOptions {
  readonly gallery: boolean
  /** A demo build (`vite build --mode demo`): it must hold every demo marker. */
  readonly demo?: boolean
}

export interface BundleReport {
  /** JS files that load with the page, before any dynamic import. */
  readonly initial: readonly string[]
  readonly shellGzip: number
  /** For each library, the JS files holding its code. */
  readonly libraries: Readonly<Partial<Record<LibraryName, readonly string[]>>>
  readonly libraryGzip: Readonly<Partial<Record<LibraryName, number>>>
  readonly galleryFiles: readonly string[]
  /** Files holding any demo marker. */
  readonly demoFiles: readonly string[]
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

/** Rule 7: none of the demo markers in production; each of them somewhere in a demo build. */
function checkDemo(files: ReadonlyArray<readonly [string, string]>, opts: BundleOptions) {
  const demoFiles = files.filter(([, t]) => DEMO_MARKERS.some((m) => t.includes(m))).map(([f]) => f)
  const violations: string[] = []
  if (opts.demo) {
    const missing = DEMO_MARKERS.filter((m) => !files.some(([, t]) => t.includes(m)))
    if (missing.length > 0) violations.push(`demo build lacks ${missing.join(', ')}`)
  } else if (!opts.gallery && demoFiles.length > 0) {
    violations.push(`production bundle holds demo code or fixture data: ${demoFiles.join(', ')}`)
  }
  return { demoFiles, violations }
}

/** The shell budget of a build: the gallery build has its own (see BUNDLE_BUDGET.galleryShellGzip). */
export function shellBudgetFor(opts: BundleOptions): number {
  return opts.gallery ? BUNDLE_BUDGET.galleryShellGzip : BUNDLE_BUDGET.shellGzip
}

export function analyseBundle(distDir: string, opts: BundleOptions): BundleReport {
  const assets = path.join(distDir, 'assets')
  const names = readdirSync(assets)
  const text = new Map(names.filter((n) => /\.(js|css)$/.test(n)).map((n) => [n, readFileSync(path.join(assets, n), 'utf-8')]))
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf-8')
  const js = new Map([...text].filter(([n]) => n.endsWith('.js')))
  const initial = initialGraph((f) => js.get(f) ?? '', entryFiles(html))
  const shellGzip = initial.reduce((sum, f) => sum + gzipSize(js.get(f) ?? ''), 0)
  const libs = checkLibraries(js, new Set(initial))
  const files = [...text.entries(), ['index.html', html] as const]
  const galleryFiles = files.filter(([, t]) => GALLERY_MARKERS.some((m) => t.includes(m))).map(([f]) => f)
  const demo = checkDemo(files, opts)
  const violations = [...libs.violations, ...demo.violations]
  for (const [f, t] of js) {
    if (t.includes(REACT_MARKER) && !f.startsWith('react-')) violations.push(`react code is in ${f}, outside its own react-*.js chunk`)
    const radix = RADIX_DIALOG_MARKERS.filter((m) => t.includes(m))
    if (radix.length > 0) violations.push(`Radix dialog code is in ${f} (${radix.join(', ')}); the alias in vite.config.ts should stub it`)
  }
  const shellBudget = shellBudgetFor(opts)
  if (shellGzip > shellBudget) violations.push(`shell JS is ${shellGzip} bytes gzip, over its ${shellBudget} budget`)
  if (!opts.gallery && galleryFiles.length > 0) violations.push(`production bundle holds gallery code: ${galleryFiles.join(', ')}`)
  if (opts.gallery && galleryFiles.length === 0) violations.push('gallery build holds no gallery code')
  return { initial, shellGzip, libraries: libs.libraries, libraryGzip: libs.libraryGzip, galleryFiles, demoFiles: demo.demoFiles, violations }
}

function main(argv: readonly string[]): number {
  const dir = argv[0]
  if (dir === undefined) {
    process.stderr.write('usage: node scripts/bundleCheck.ts <dist dir> [--gallery | --demo]\n')
    return 2
  }
  const opts = { gallery: argv.includes('--gallery'), demo: argv.includes('--demo') }
  const report = analyseBundle(path.resolve(dir), opts)
  const kb = (n: number) => `${(n / 1000).toFixed(1)} kB`
  process.stdout.write(`bundle check: shell ${kb(report.shellGzip)} gzip of ${kb(shellBudgetFor(opts))} (${report.initial.join(', ')})\n`)
  for (const [lib, size] of Object.entries(report.libraryGzip)) {
    process.stdout.write(`bundle check: ${lib} ${kb(size)} gzip of ${kb(BUNDLE_BUDGET.libraryGzip[lib as LibraryName])}\n`)
  }
  for (const v of report.violations) process.stderr.write(`bundle check FAILED: ${v}\n`)
  return report.violations.length === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
