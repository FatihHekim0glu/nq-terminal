// The bundle check (TASKS Phase 5 stage A): the shell stays small, each chart library is its own
// lazily loaded chunk, and a production build carries no gallery code and no demo code or fixture data.
// The first block checks the checker on hand-made bundles (each rule born failing); the second runs real
// Vite builds.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { build as viteBuildApi } from 'vite'
import {
  CHUNK_GROUPS,
  DEMO_MODE,
  DEMO_OUT_DIR,
  GALLERY_MODE,
  GALLERY_OUT_DIR,
  LIBRARY_CHUNKS,
  PRELOAD_HELPER,
  RESOLVE_ALIASES,
  SELFTEST_BASE,
  SELFTEST_MODE,
  SELFTEST_OUT_DIR,
  baseFor,
  buildInputs,
  outDirFor,
} from '../vite.config.ts'
import { BUNDLE_BUDGET, DEMO_MARKERS, GALLERY_MARKERS, LIBRARY_MARKERS, RADIX_DIALOG_MARKERS, SELFTEST_MARKERS, analyseBundle } from './bundleCheck.ts'

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

/** Random base64 text whose gzip size (level 9, as bundleCheck measures it) is within 200 bytes of `target`. */
function textGzipping(target: number): string {
  const pool = randomBytes(Math.ceil(target * 1.4)).toString('base64')
  const size = (n: number) => gzipSync(Buffer.from(pool.slice(0, n), 'utf-8'), { level: 9 }).length
  let low = 0
  let high = pool.length
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    if (size(mid) > target) high = mid
    else low = mid
  }
  return pool.slice(0, low)
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

  it('fails a production bundle holding the demo boot or a fixture-only run id', () => {
    const withBoot = fakeDist({ 'index.js': '', 'boot-2.js': 'const k=Symbol.for("nqt-demo")' })
    const report = analyseBundle(withBoot, { gallery: false })
    expect(report.demoFiles).toEqual(['boot-2.js'])
    expect(report.violations.join('\n')).toMatch(/production bundle holds demo code or fixture data: boot-2\.js/)
    const withFixture = fakeDist({ 'index.js': '', 'runs-1.js': 'const r={run_id:"nt_volmanaged_v0_fixture_m1"}' })
    expect(analyseBundle(withFixture, { gallery: false }).violations.join('\n')).toMatch(/demo code or fixture data: runs-1\.js/)
  })

  it('fails a demo bundle missing any demo marker, and passes one holding them all', () => {
    const complete = fakeDist({ 'index.js': '', 'boot-2.js': `const k=${JSON.stringify(DEMO_MARKERS)}` })
    const ok = analyseBundle(complete, { gallery: false, demo: true })
    expect(ok.violations).toEqual([])
    expect(ok.demoFiles).toEqual(['boot-2.js'])
    const bootOnly = fakeDist({ 'index.js': '', 'boot-2.js': 'const k=Symbol.for("nqt-demo")' })
    expect(analyseBundle(bootOnly, { gallery: false, demo: true }).violations.join('\n')).toMatch(/demo build lacks nt_volmanaged_v0_fixture_m1/)
    const none = fakeDist({ 'index.js': '' })
    expect(analyseBundle(none, { gallery: false, demo: true }).violations.join('\n')).toMatch(/demo build lacks nqt-demo, nt_volmanaged_v0_fixture_m1/)
  })

  it('fails a bundle holding Radix dialog code, in the shell or in a lazy chunk (rule 8)', () => {
    expect(RADIX_DIALOG_MARKERS.length).toBeGreaterThan(0)
    for (const marker of RADIX_DIALOG_MARKERS) {
      const inShell = fakeDist({ 'index.js': `const m="${marker}"` })
      expect(analyseBundle(inShell, { gallery: false }).violations.join('\n'), marker).toMatch(/Radix dialog code is in index\.js/)
      const inLazy = fakeDist({ 'index.js': '', 'Screen-1.js': `const m="${marker}"` })
      expect(analyseBundle(inLazy, { gallery: false }).violations.join('\n'), marker).toMatch(/Radix dialog code is in Screen-1\.js/)
    }
    const clean = fakeDist({ 'index.js': 'const m="cmdk-item"', 'Screen-1.js': 'const m="dialog"' })
    expect(analyseBundle(clean, { gallery: false }).violations).toEqual([])
  })

  it('holds a gallery build to its own, slightly larger shell budget (its entry loads the API client eagerly)', () => {
    expect(BUNDLE_BUDGET.galleryShellGzip).toBeGreaterThan(BUNDLE_BUDGET.shellGzip)
    expect(BUNDLE_BUDGET.galleryShellGzip - BUNDLE_BUDGET.shellGzip).toBeLessThanOrEqual(2_000)
    // A shell between the two budgets: too big for production and the demo, fine for the gallery.
    const between = textGzipping((BUNDLE_BUDGET.shellGzip + BUNDLE_BUDGET.galleryShellGzip) / 2)
    const dir = fakeDist({ 'index.js': between, 'entry-1.js': 'const p="/__gallery"' })
    expect(analyseBundle(dir, { gallery: false }).violations.join('\n')).toMatch(/shell JS is \d+ bytes gzip, over its 1\d+ budget/)
    expect(analyseBundle(dir, { gallery: true }).violations).toEqual([])
    expect(analyseBundle(dir, { gallery: false, demo: true }).violations.join('\n')).toMatch(/shell JS/)
  })

  it('names the budget it applied when the shell is over it', () => {
    const over = textGzipping(BUNDLE_BUDGET.galleryShellGzip + 3_000)
    const dir = fakeDist({ 'index.js': over, 'entry-1.js': 'const p="/__gallery"' })
    expect(analyseBundle(dir, { gallery: true }).violations.join('\n')).toContain(`over its ${BUNDLE_BUDGET.galleryShellGzip} budget`)
    expect(analyseBundle(dir, { gallery: false }).violations.join('\n')).toContain(`over its ${BUNDLE_BUDGET.shellGzip} budget`)
  })

  it('does not hold a gallery build to the demo rule (gallery entries may show fixture captures)', () => {
    const gallery = fakeDist({ 'index.js': '', 'entry-1.js': '"/__gallery";"nt_volmanaged_v0_fixture_m1"' })
    expect(analyseBundle(gallery, { gallery: true }).violations).toEqual([])
  })
})

/** A fake self-test dist: its page is served under /__selftest/, so its assets are too. */
function fakeSelftestDist(files: Readonly<Record<string, string>>): string {
  const dir = fakeDist(files)
  writeFileSync(path.join(dir, 'index.html'), `<script type="module" crossorigin src="${SELFTEST_BASE}assets/index.js"></script>`, 'utf-8')
  return dir
}

describe('rule 9: the self-test page is in no production build (D7.2)', () => {
  it('names markers only the self-test page holds', () => {
    expect(SELFTEST_MARKERS).toEqual(['nqt-selftest', '__selftest'])
  })

  it('born failing: a production bundle holding the self-test page fails, whichever marker it carries', () => {
    for (const marker of SELFTEST_MARKERS) {
      const planted = fakeDist({ 'index.js': '', 'boot-3.js': `const k="${marker}"` })
      const report = analyseBundle(planted, { gallery: false })
      expect(report.selftestFiles, marker).toEqual(['boot-3.js'])
      expect(report.violations.join('\n'), marker).toMatch(/production bundle holds self-test code: boot-3\.js/)
    }
  })

  it('born failing: a planted import in the shell itself is found in the shell', () => {
    const inShell = fakeDist({ 'index.js': 'window.__selftest={}' })
    expect(analyseBundle(inShell, { gallery: false }).violations.join('\n')).toMatch(/self-test code: index\.js/)
  })

  it('fails the gallery and the demo build too: the page is in no build but its own', () => {
    const planted = fakeDist({ 'index.js': '', 'boot-3.js': 'const k="nqt-selftest"' })
    expect(analyseBundle(planted, { gallery: true }).violations.join('\n')).toMatch(/self-test code/)
    expect(analyseBundle(planted, { gallery: false, demo: true }).violations.join('\n')).toMatch(/self-test code/)
  })

  it('fails a self-test build that holds none of its markers, and passes one that holds them all', () => {
    const empty = fakeSelftestDist({ 'index.js': '' })
    expect(analyseBundle(empty, { gallery: false, selftest: true }).violations.join('\n')).toMatch(/self-test build lacks nqt-selftest, __selftest/)
    const complete = fakeSelftestDist({ 'index.js': `const k=${JSON.stringify(SELFTEST_MARKERS)}` })
    const ok = analyseBundle(complete, { gallery: false, selftest: true })
    expect(ok.violations).toEqual([])
    expect(ok.selftestFiles).toEqual(['index.js'])
    const half = fakeSelftestDist({ 'index.js': 'const k="nqt-selftest"' })
    expect(analyseBundle(half, { gallery: false, selftest: true }).violations.join('\n')).toMatch(/lacks __selftest/)
  })

  it('reads the entry of a page served under a base path, so the shell budget still applies to it', () => {
    const over = textGzipping(BUNDLE_BUDGET.selftestShellGzip + 3_000)
    const dir = fakeSelftestDist({ 'index.js': `const k=${JSON.stringify(SELFTEST_MARKERS)};${over}` })
    const report = analyseBundle(dir, { gallery: false, selftest: true })
    expect(report.initial).toEqual(['index.js'])
    expect(report.violations.join('\n')).toContain(`over its ${BUNDLE_BUDGET.selftestShellGzip} budget`)
  })

  it('keeps a library out of the self-test shell as well: Perspective loads through its dynamic import', () => {
    const dir = fakeSelftestDist({ 'index.js': `import"./perspective-1.js";const k=${JSON.stringify(SELFTEST_MARKERS)}`, 'perspective-1.js': '"PerspectiveViewerElement"' })
    expect(analyseBundle(dir, { gallery: false, selftest: true }).violations.join('\n')).toMatch(/perspective.*shell/)
  })
})

describe('the check matches the Vite config', () => {
  it('has markers and a budget for every library chunk group', () => {
    const names = LIBRARY_CHUNKS.map((c) => c.name).sort()
    expect(Object.keys(LIBRARY_MARKERS).sort()).toEqual(names)
    expect(Object.keys(BUNDLE_BUDGET.libraryGzip).sort()).toEqual(names)
    expect(GALLERY_MARKERS.length).toBeGreaterThan(0)
  })

  it('has the demo boot marker and a fixture-only run id among the demo markers', () => {
    expect(DEMO_MARKERS).toEqual(['nqt-demo', 'nt_volmanaged_v0_fixture_m1'])
  })

  it('writes the gallery and the demo to their own out dirs, never over the production dist', () => {
    expect(outDirFor('production')).toBe('dist')
    expect(outDirFor(GALLERY_MODE)).toBe(GALLERY_OUT_DIR)
    expect(outDirFor(DEMO_MODE)).toBe(DEMO_OUT_DIR)
    expect([GALLERY_OUT_DIR, DEMO_OUT_DIR]).toEqual(['dist-gallery', 'dist-demo'])
  })

  it('builds the self-test page (and only it) into dist-selftest, under /__selftest/, never over the production dist', () => {
    expect(SELFTEST_MODE).toBe('selftest')
    expect(outDirFor(SELFTEST_MODE)).toBe(SELFTEST_OUT_DIR)
    expect(SELFTEST_OUT_DIR).toBe('dist-selftest')
    expect(baseFor(SELFTEST_MODE)).toBe('/__selftest/')
    expect(SELFTEST_BASE).toBe('/__selftest/')
    for (const mode of ['production', GALLERY_MODE, DEMO_MODE]) expect(baseFor(mode), mode).toBe('/')
    const inputs = buildInputs(SELFTEST_MODE) ?? {}
    expect(Object.values(inputs).map((p) => path.relative(WEB_DIR, p).split(path.sep).join('/'))).toEqual(['src/selftest/index.html'])
    for (const mode of ['production', GALLERY_MODE]) {
      expect(JSON.stringify(buildInputs(mode)), mode).not.toMatch(/selftest/)
    }
  })

  it('has a build:selftest script that builds the page and checks it as a self-test build, and pins axe-core to one version', () => {
    const pkg = JSON.parse(readFileSync(path.join(WEB_DIR, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
      dependencies: Record<string, string>
    }
    expect(pkg.scripts['build:selftest']).toBe('vite build --mode selftest && node scripts/bundleCheck.ts dist-selftest --selftest')
    expect(pkg.devDependencies['axe-core']).toMatch(/^\d+\.\d+\.\d+$/)
    expect(pkg.dependencies['axe-core']).toBeUndefined()
    expect(pkg.scripts.build).not.toMatch(/selftest/)
  })

  it('aliases exactly the two Radix imports cmdk does not need the real package for, each to its local stub, and nothing else', () => {
    // cmdk imports @radix-ui/react-dialog only for Command.Dialog, which the terminal never renders, and reads two elements
    // (div and input) from @radix-ui/react-primitive, whose asChild mode (Radix's Slot) the terminal never uses.
    expect(RESOLVE_ALIASES).toHaveLength(2)
    const [dialog, primitive] = RESOLVE_ALIASES
    expect(dialog.find.test('@radix-ui/react-dialog')).toBe(true)
    expect(primitive.find.test('@radix-ui/react-primitive')).toBe(true)
    const others = [
      '@radix-ui/react-dialog/dist/index.mjs',
      '@radix-ui/react-dialog-extra',
      'x@radix-ui/react-dialog',
      '@radix-ui/react-primitive/dist/index.mjs',
      '@radix-ui/react-primitive-extra',
      'x@radix-ui/react-primitive',
      '@radix-ui/react-slot',
      '@radix-ui/react-id',
      '@radix-ui/react-compose-refs',
      '@radix-ui/react-popover',
      'cmdk',
      'react',
      './radixDialogStub',
      './radixPrimitiveStub',
    ]
    for (const other of others) {
      expect(dialog.find.test(other), `dialog: ${other}`).toBe(false)
      expect(primitive.find.test(other), `primitive: ${other}`).toBe(false)
    }
    expect(dialog.find.test('@radix-ui/react-primitive')).toBe(false)
    expect(primitive.find.test('@radix-ui/react-dialog')).toBe(false)
    expect(path.relative(WEB_DIR, dialog.replacement)).toBe(path.join('src', 'vendor', 'radixDialogStub.tsx'))
    expect(path.relative(WEB_DIR, primitive.replacement)).toBe(path.join('src', 'vendor', 'radixPrimitiveStub.tsx'))
    expect(existsSync(dialog.replacement)).toBe(true)
    expect(existsSync(primitive.replacement)).toBe(true)
  })

  it('captures React before any library group, so no library chunk can pull React in', () => {
    // Rolldown's groups include each captured module's dependencies (includeDependenciesRecursively),
    // so a library group ranked above React takes React into the library chunk.
    const priority = (name: string) => CHUNK_GROUPS.find((g) => g.name === name)?.priority ?? -1
    for (const lib of LIBRARY_CHUNKS) expect(priority('react'), lib.name).toBeGreaterThan(priority(lib.name))
  })

  it('captures the Vite preload helper before any library group, so the shell never loads Perspective', () => {
    // Perspective's viewer has import() calls of its own, so its group took the helper the shell needs
    // for its lazy screens and index.html preloaded the whole Perspective chunk (shell 207.7 kB gzip).
    expect(PRELOAD_HELPER.test(' vite/preload-helper.js')).toBe(true)
    expect(PRELOAD_HELPER.test('C:/x/node_modules/vite/preload-helper.js')).toBe(true)
    expect(PRELOAD_HELPER.test('C:/x/node_modules/@perspective-dev/viewer/dist/esm/index.js')).toBe(false)
    const helper = CHUNK_GROUPS.find((g) => g.test === PRELOAD_HELPER)
    expect(helper?.name).toBe('preload')
    for (const lib of LIBRARY_CHUNKS) expect(helper?.priority ?? -1, lib.name).toBeGreaterThan(CHUNK_GROUPS.find((g) => g.name === lib.name)?.priority ?? 0)
  })
})

function viteBuild(mode: 'production' | 'gallery' | 'demo' | 'selftest', outDir: string): void {
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
    expect(report.demoFiles).toEqual([])
  }, 120_000)

  it('gallery: the gallery is there and each chart library is its own lazy chunk', () => {
    const out = tempDir('nqt-gallery-')
    viteBuild('gallery', out)
    const report = analyseBundle(out, { gallery: true })
    expect(report.violations).toEqual([])
    expect(report.galleryFiles.length).toBeGreaterThan(0)
    // The ChartLibraries entry loads all three, each through src/charts/lazy.ts.
    // The Perspective gallery entry loads the pivot grid lazily too.
    expect(report.libraries.perspective).toHaveLength(1)
    expect(report.initial.some((f) => f.startsWith('perspective-'))).toBe(false)
    for (const lib of ['uplot', 'lightweight-charts', 'echarts'] as const) {
      expect(report.libraries[lib], lib).toHaveLength(1)
      expect(report.libraries[lib]?.[0]).toMatch(new RegExp(`^${lib}-`))
      expect(report.initial.some((f) => f.startsWith(`${lib}-`)), lib).toBe(false)
    }
  }, 120_000)

  it('demo: the demo layer and its fixture data are there, lazily, with no gallery code', () => {
    const out = tempDir('nqt-demo-')
    viteBuild('demo', out)
    const report = analyseBundle(out, { gallery: false, demo: true })
    expect(report.violations).toEqual([])
    expect(report.galleryFiles).toEqual([])
    // The demo chunk (fixture bodies and all) loads through main.tsx's import(), never with the shell.
    expect(report.demoFiles.length).toBeGreaterThan(0)
    expect(report.demoFiles.some((f) => report.initial.includes(f))).toBe(false)
  }, 120_000)

  it('selftest: the page, its goldens and axe are there, the page is index.html, and no production file is', () => {
    const out = tempDir('nqt-selftest-')
    viteBuild('selftest', out)
    expect(existsSync(path.join(out, 'index.html'))).toBe(true)
    expect(existsSync(path.join(out, 'src'))).toBe(false)
    const report = analyseBundle(out, { gallery: false, selftest: true })
    expect(report.violations).toEqual([])
    expect(report.selftestFiles.length).toBeGreaterThan(0)
    expect(report.initial.length).toBeGreaterThan(0)
    expect(report.galleryFiles).toEqual([])
    expect(report.demoFiles).toEqual([])
    // axe, dockview and Perspective are chunks of their own, behind dynamic imports: the page paints before any of them loads.
    const names = readdirSync(path.join(out, 'assets'))
    for (const chunk of ['axe', 'dockview', 'perspective']) {
      expect(names.some((n) => n.startsWith(`${chunk}-`) && n.endsWith('.js')), chunk).toBe(true)
      expect(report.initial.some((f) => f.startsWith(`${chunk}-`)), `${chunk} in the shell`).toBe(false)
    }
  }, 180_000)

  it('born failing: a production build whose entry imports the self-test page fails the check', async () => {
    const out = tempDir('nqt-planted-')
    // The plant: main.tsx (the production entry) gains one dynamic import of the page's entry module, as a careless edit would.
    const plant = {
      name: 'nqt:plant-selftest',
      enforce: 'pre' as const,
      transform(code: string, id: string) {
        return /[\\/]src[\\/]main\.tsx$/.test(id) ? `${code}\nvoid import('./selftest/main')\n` : null
      },
    }
    await viteBuildApi({ root: WEB_DIR, mode: 'production', logLevel: 'error', plugins: [plant], build: { outDir: out, emptyOutDir: true } })
    const report = analyseBundle(out, { gallery: false })
    expect(report.selftestFiles.length).toBeGreaterThan(0)
    expect(report.violations.join('\n')).toMatch(/production bundle holds self-test code/)
  }, 180_000)
})
