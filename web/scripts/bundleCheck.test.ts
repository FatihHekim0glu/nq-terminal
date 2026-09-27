// The bundle check (TASKS Phase 5 stage A): the shell stays small, each chart library is its own
// lazily loaded chunk, and a production build carries no gallery code. The first block checks the
// checker on hand-made bundles (each rule born failing); the second runs real Vite builds.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { CHUNK_GROUPS, LIBRARY_CHUNKS } from '../vite.config.ts'
import { BUNDLE_BUDGET, GALLERY_MARKERS, LIBRARY_MARKERS, analyseBundle } from './bundleCheck.ts'

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temps: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

/** A fake dist: index.html loading `index.js` (plus preloads), and the given asset files. */
function fakeDist(files: Readonly<Record<string, string>>, preload: readonly string[] = []): string {
  const dir = tempDir('nqt-fake-dist-')
  mkdirSync(path.join(dir, 'assets'))
  const links = preload.map((f) => `<link rel="modulepreload" crossorigin href="/assets/${f}">`).join('\n')
  writeFileSync(path.join(dir, 'index.html'), `<script type="module" crossorigin src="/assets/index.js"></script>\n${links}`, 'utf-8')
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, 'assets', name), text, 'utf-8')
  return dir
}

describe('analyseBundle on hand-made bundles', () => {
  it('passes a small shell whose library loads through a dynamic import', () => {
    const dir = fakeDist({
      'index.js': 'import{a}from"./react-1.js";const u=()=>import("./uplot-1.js");',
      'react-1.js': 'export const a=1',
      'uplot-1.js': 'const c="u-cursor-x";export default c',
    })
    const report = analyseBundle(dir, { gallery: false })
    expect(report.violations).toEqual([])
    expect(report.initial).toEqual(['index.js', 'react-1.js'])
    expect(report.libraries.uplot).toEqual(['uplot-1.js'])
  })

  it('fails when library code is in the shell (static import or preload)', () => {
    const viaImport = fakeDist({ 'index.js': 'import"./uplot-1.js";', 'uplot-1.js': '"u-cursor-x"' })
    expect(analyseBundle(viaImport, { gallery: false }).violations.join('\n')).toMatch(/uplot.*shell/)
    const viaPreload = fakeDist({ 'index.js': '', 'vendor-1.js': '"tv-lightweight-charts"' }, ['vendor-1.js'])
    expect(analyseBundle(viaPreload, { gallery: false }).violations.join('\n')).toMatch(/lightweight-charts.*shell/)
  })

  it('fails when a library is split over two chunks or lands in a chunk of the wrong name', () => {
    const split = fakeDist({ 'index.js': '', 'echarts-1.js': '"__ec_inner"', 'Heatmap-1.js': '"__ec_inner"' })
    expect(analyseBundle(split, { gallery: false }).violations.join('\n')).toMatch(/echarts.*Heatmap-1\.js/)
    const misnamed = fakeDist({ 'index.js': '', 'vendor-2.js': '"u-cursor-x"' })
    expect(analyseBundle(misnamed, { gallery: false }).violations.join('\n')).toMatch(/uplot.*vendor-2\.js/)
  })

  it('fails when React code lands outside the react chunk (a library group pulled it in)', () => {
    // The shell then imports the library chunk to get React: tanstack-grid loaded with every page.
    const dir = fakeDist({
      'index.js': 'import{c}from"./tanstack-grid-1.js";',
      'tanstack-grid-1.js': 'const r=Symbol.for(`react.transitional.element`);"coreRowModelsFeature";export const c=r',
    })
    const text = analyseBundle(dir, { gallery: false }).violations.join('\n')
    expect(text).toMatch(/react code is in tanstack-grid-1\.js/)
    expect(text).toMatch(/tanstack-grid.*shell/)
  })

  it('fails over the shell budget and over a library budget', () => {
    // Random text, so gzip cannot shrink it below the budgets (about 300 kB gzip).
    const big = randomBytes(300_000).toString('base64')
    const heavy = fakeDist({ 'index.js': big })
    expect(analyseBundle(heavy, { gallery: false }).violations.join('\n')).toMatch(/shell JS/)
    const lib = fakeDist({ 'index.js': '', 'uplot-1.js': `"u-cursor-x";${big}` })
    expect(analyseBundle(lib, { gallery: false }).violations.join('\n')).toMatch(/uplot chunk/)
  })

  it('fails a production bundle holding gallery code, and a gallery bundle without it', () => {
    const withGallery = fakeDist({ 'index.js': '', 'boot-1.js': 'const p="/__gallery"' })
    expect(analyseBundle(withGallery, { gallery: false }).violations.join('\n')).toMatch(/gallery code/)
    const without = fakeDist({ 'index.js': '' })
    expect(analyseBundle(without, { gallery: true }).violations.join('\n')).toMatch(/no gallery code/)
  })
})

describe('the check matches the Vite config', () => {
  it('has markers and a budget for every library chunk group', () => {
    const names = LIBRARY_CHUNKS.map((c) => c.name).sort()
    expect(Object.keys(LIBRARY_MARKERS).sort()).toEqual(names)
    expect(Object.keys(BUNDLE_BUDGET.libraryGzip).sort()).toEqual(names)
    expect(GALLERY_MARKERS.length).toBeGreaterThan(0)
  })

  it('captures React before any library group, so no library chunk can pull React in', () => {
    // Rolldown's groups include each captured module's dependencies (includeDependenciesRecursively),
    // so a library group ranked above React takes React into the library chunk.
    const priority = (name: string) => CHUNK_GROUPS.find((g) => g.name === name)?.priority ?? -1
    for (const lib of LIBRARY_CHUNKS) expect(priority('react'), lib.name).toBeGreaterThan(priority(lib.name))
  })
})

function viteBuild(mode: 'production' | 'gallery', outDir: string): void {
  const vite = path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
  execFileSync(process.execPath, [vite, 'build', '--mode', mode, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB_DIR,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'pipe',
  })
}

describe('real builds', () => {
  it('production: small shell, no chart library in it, no gallery code anywhere', () => {
    const out = tempDir('nqt-prod-')
    viteBuild('production', out)
    const report = analyseBundle(out, { gallery: false })
    expect(report.violations).toEqual([])
    expect(report.shellGzip).toBeLessThanOrEqual(BUNDLE_BUDGET.shellGzip)
    expect(report.galleryFiles).toEqual([])
  }, 120_000)

  it('gallery: the gallery is there and each chart library is its own lazy chunk', () => {
    const out = tempDir('nqt-gallery-')
    viteBuild('gallery', out)
    const report = analyseBundle(out, { gallery: true })
    expect(report.violations).toEqual([])
    expect(report.galleryFiles.length).toBeGreaterThan(0)
    // The ChartLibraries entry loads all three, each through src/charts/lazy.ts.
    for (const lib of ['uplot', 'lightweight-charts', 'echarts'] as const) {
      expect(report.libraries[lib], lib).toHaveLength(1)
      expect(report.libraries[lib]?.[0]).toMatch(new RegExp(`^${lib}-`))
      expect(report.initial.some((f) => f.startsWith(`${lib}-`)), lib).toBe(false)
    }
  }, 120_000)
})
