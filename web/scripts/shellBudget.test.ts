// The first-paint shell diet (roadmap wave 6, SHELL-DIET; wave 7, SHELL-DIET-2; wave 9, SHELL-DIET-3; v2.1 polish, SHELL-DIET-4): code that first paint does not
// need loads through a dynamic import, and the shell's gzip ceiling is pinned close to its measured size so later
// waves cannot grow it back unnoticed. One real production build; each moved piece is found by a string only it holds:
// present somewhere in the build (it still exists) and absent from every chunk that loads with index.html.
// scripts/bundleCheck.test.ts holds the generic rules (library chunks, gallery and demo code).
//
// How to keep code out of the shell (measured while making this list): move the definition into a module only
// lazy code imports, and point the importers at it. Do not leave a re-export ("barrel") behind in the shell
// module: rolldown then sees a static edge from the shell to a lazy module, and to avoid a cycle it hoists
// unrelated shared modules (parser, registry, WorkspaceFocus...) into extra shell chunks, which made the shell
// 1.5 kB bigger than moving nothing. A module used by both the shell and a lazy chunk stays whole in the
// shell, with every export either of them uses, so split such a module by what each side reads.
//
// Shell diet 3 adds four lessons. (1) A lazy chunk that itself dynamically imports another chunk (the record watch's
// reader loading its diff) makes rolldown hoist what the shell and that second chunk both use (state/safeStorage.ts)
// into an extra shell chunk, worth more than the code it saved: the shell view (chrome/RecordWatch.view.tsx) imports
// the schema's types only and writes out its one value, the empty diff. The chunk list test below fails on any extra
// shell chunk. (2) In tests, vi.resetModules() makes each fresh import() build a new copy of a module, so a component
// loaded on demand is fetched once and cached (AppCommandBar.tsx loadReader), the way React.lazy caches. (3) The
// "vendor" group in vite.config.ts takes every node_modules file the app uses, so a library only lazy code needs is
// still in the shell's vendor chunk: useQueries with its QueriesObserver (REG and DES only) is about 0.85 kB gzip, and
// cmdk's unused command-score about 0.4 kB; the group skips the first (a lookahead on the two file names) and a plugin
// stubs the second (see the end of this file). (4) The print dossier is lazy the same way: its runner, page and
// stylesheet are checked below, and no stylesheet that index.html links may hold a dossier rule.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHUNK_GROUPS } from '../vite.config.ts'
import { BUNDLE_BUDGET, RADIX_DIALOG_MARKERS, analyseBundle, type BundleReport } from './bundleCheck.ts'

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The shell ceiling, in gzip bytes: what shell diet 3 reached (112,824 B, from 116,499 B after wave 8; 115,167 B
 * after shell diet 2, 125,385 B after the wave 6 diet and 132,131 B before it) plus 2 kB of room, rounded up to 100 B.
 * BUNDLE_BUDGET.shellGzip in bundleCheck.ts must not be raised above it. To grow the shell on purpose, move something
 * else out first, or raise this number in the same change as the feature that needs it, with the reason in the commit.
 * A change that cuts the shell further can lower both.
 */
const PINNED_SHELL_CEILING = 114_900
/**
 * Shell diet 4 (v2.1 polish): the shell was 114,480 B before it and is 109,658 B after (the key actions, the command line's
 * menus and suggestion sheet load on demand; Radix's Slot, TanStack's infinite-query paging, useMutation and the module
 * preload polyfill are out of the shell). The owner's target is 109,900 B at most, which leaves 5 kB under the ceiling
 * above for the next waves. Unlike the ceiling this is a ratchet: to grow the shell past it on purpose, move something else
 * out first, or raise this number in the same change as the feature that needs it, with the reason in the commit.
 */
const SHELL_TARGET_AFTER_DIET_4 = 109_900
/** The gallery build's shell, which is about 0.9 kB larger (113,738 B measured), plus the same 2 kB. */
const PINNED_GALLERY_SHELL_CEILING = 115_800

/** [what it is, a string only that code holds]. Each is reached only through a dynamic import. */
const ON_DEMAND: ReadonlyArray<readonly [string, string]> = [
  ['the panels\' parts copy: export, related menu, quote, field, chart (copy/panelParts.ts)', 'Saved {n} rows as {file}.'],
  ['the screen data hooks (api/queries.screens.ts)', '/api/market/paper-rolls'],
  ['the live stream client (api/liveStream.ts, api/useLiveStream.ts)', 'stallHeartbeats'],
  ['the key map overlay (chrome/KeyToolbar.overlay.tsx)', 'nqt-keymap-title'],
  ['the HELP screen copy and drawn keyboard (copy/help.ts)', 'Drawn keyboard: the terminal keys in their colours'],
  ['the event tape (chrome/EventTape.tsx, off by default)', 'tape-lines'],
  ['the panels\' roving focus code (chrome/WorkspaceFocus.ts)', 'data-roving-vertical-list'],
  // GRAB (roadmap wave 7): the Workspace chunk holds the Options rows, and export/grab/run.ts loads on click.
  ['the panel image export (chrome/panelExport.ts, copy/grab.ts, export/grab/*)', 'Grab as image'],
  ['the GRAB caption (copy/grab.ts, used by export/grab/*)', 'grabbed {time}'],
  // Shell diet 3 (roadmap wave 9): the record watch's six reads and WATCH SEEN load with the reader; the shell keeps
  // the view store and the status segment (chrome/RecordWatch.view.tsx).
  ['the record watch reader (chrome/RecordWatch.live.tsx, copy/watchReader.ts)', 'This browser could not keep a watch checkpoint'],
  // The address bar's link reader (chrome/DeepLinks.tsx) mounts from AppCommandBar.tsx through a dynamic import.
  ['the deep link reader (chrome/useDeepLinks.ts, chrome/deepLink.ts, copy/links.ts)', 'cannot run from a link'],
  // Copy only an on-demand chunk reads lives beside that chunk, not in copy/chrome.ts or copy/workspace.ts.
  ['the event tape copy (copy/tape.ts, read by chrome/EventTape.tsx)', 'The gate log did not answer.'],
  ['the key map overlay copy (copy/keymap.ts, read by chrome/KeyToolbar.overlay.tsx)', 'Close the key map'],
  ['the placeholder screen copy (copy/placeholder.ts, read by chrome/WorkspacePlaceholder.tsx)', 'This screen arrives in phase'],
  // The vendor group in vite.config.ts leaves useQueries and its QueriesObserver out of the shared vendor chunk (only
  // REG and DES call useQueries), so they load with those screens. The string survives minification.
  ['useQueries with its QueriesObserver (REG and DES only; vite.config.ts vendor group)', 'getQueries(){'],
  // The print dossier (roadmap wave 9): the menu item that starts it is in the Workspace chunk, and the runner, the
  // page and the stylesheet load with the first dossier printed (export/print/run.tsx).
  ['the print dossier runner, page and stylesheet (export/print/*)', 'nqt-print-root'],
  ['the print dossier menu copy (copy/dossier.ts, read by chrome/panelExport.ts)', 'Print dossier'],
  // Shell diet 4 (v2.1 polish): what a key press or a menu needs loads on demand through a small loader in the shell
  // (chrome/KeyToolbar.lazy.ts, chrome/CommandLine.menus.load.ts) and is preloaded at the first idle moment.
  ['the key actions and their copy (chrome/KeyToolbar.actions.ts, copy/navKeys.ts)', 'F5 would reload'],
  ["the command line's menu builders and the sector menu copy (chrome/CommandLine.menus.ts, copy/sectorMenu.ts)", 'No futures in nq-lab carry this sector key.'],
  ['the numbered menu sheet (chrome/CommandLine.menu.tsx)', 'menu-crumb'],
  ['the suggestion sheet (chrome/CommandLine.sheet.tsx)', 'grp-head'],
  // useMutation and its MutationObserver are called by JOBS only: the vendor group skips them, like useQueries.
  ['useMutation with its MutationObserver (JOBS only; vite.config.ts vendor group)', 'mutateAsync'],
]

/** Strings the shell must still hold: they prove the search below can find shell code at all. */
const IN_SHELL: ReadonlyArray<readonly [string, string]> = [
  ['the health poll (api/queries.ts)', '/api/health'],
  ['the workspace loading copy (copy/workspace.ts)', 'The workspace is still loading'],
  ['the key actions loader and its failure line (chrome/KeyToolbar.lazy.ts, copy/chrome.ts)', 'The keys could not load'],
  ['the menu loader and its failure line (chrome/CommandLine.menus.load.ts, copy/chrome.ts)', 'The menu could not load'],
  ['the infinite-query stub (src/vendor/infiniteQueryBehaviorStub.ts, vite.config.ts infiniteStub)', 'Infinite queries are not available'],
  ['the Radix primitive stub (src/vendor/radixPrimitiveStub.tsx, vite.config.ts RESOLVE_ALIASES)', 'needs Radix'],
  ['the record watch status segment (chrome/RecordWatch.view.tsx, copy/watch.ts)', 'A record that should not change was rewritten'],
]

const temps: string[] = []
let outDir = ''
let report: BundleReport
let shellText = ''
let buildText = ''

beforeAll(() => {
  const out = mkdtempSync(path.join(tmpdir(), 'nqt-shell-'))
  outDir = out
  temps.push(out)
  const vite = path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
  execFileSync(process.execPath, [vite, 'build', '--mode', 'production', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB_DIR,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'pipe',
  })
  report = analyseBundle(out, { gallery: false })
  const assets = path.join(out, 'assets')
  const read = (file: string) => readFileSync(path.join(assets, file), 'utf-8')
  shellText = report.initial.map(read).join('\n')
  buildText = readdirSync(assets).filter((f) => f.endsWith('.js')).map(read).join('\n')
}, 120_000)

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

describe('the shell ceiling', () => {
  it('is enforced by bundleCheck at no more than the pinned ceiling, for the gallery build too', () => {
    expect(BUNDLE_BUDGET.shellGzip).toBeLessThanOrEqual(PINNED_SHELL_CEILING)
    expect(BUNDLE_BUDGET.galleryShellGzip).toBeLessThanOrEqual(PINNED_GALLERY_SHELL_CEILING)
  })

  it('holds for a real production build, with no other bundle rule broken', () => {
    expect(report.violations).toEqual([])
    expect(report.shellGzip).toBeLessThanOrEqual(BUNDLE_BUDGET.shellGzip)
  })

  it('stays at the shell diet 4 target (109.9 kB gzip), 5 kB under the ceiling', () => {
    expect(report.shellGzip).toBeLessThanOrEqual(SHELL_TARGET_AFTER_DIET_4)
    expect(BUNDLE_BUDGET.shellGzip - report.shellGzip).toBeGreaterThanOrEqual(5_000)
  })
})

describe('the shell chunks', () => {
  /** A chunk's name without its content hash: `safeStorage-C-Ref7H8.js` is `safeStorage`. */
  const nameOf = (file: string) => file.replace(/-[\w-]{8}\.js$/, '')

  it('are the entry, the runtime, React, the vendor libraries, the preload helper and the two shared copy modules, and nothing hoisted', () => {
    // A lazy module reached from two levels of dynamic imports makes rolldown split a shared shell module into a chunk
    // of its own (see the header). If this list must change on purpose, say why here.
    expect(report.initial.map(nameOf).sort()).toEqual(['commands', 'index', 'preload', 'react', 'rolldown-runtime', 'sectors', 'vendor'])
  })
})

describe('code that first paint does not need', () => {
  it.each(ON_DEMAND)('%s loads lazily: in the build, not in the shell', (_what, marker) => {
    // Booleans, not toContain: a failed toContain prints the whole bundle.
    expect(buildText.includes(marker), `the build no longer holds ${marker}: update the marker`).toBe(true)
    expect(shellText.includes(marker), `${marker} is back in the shell`).toBe(false)
  })

  it.each(IN_SHELL)('the search can see shell code: %s', (_what, marker) => {
    expect(shellText.includes(marker), `${marker} is not in the shell`).toBe(true)
  })
})

// Shell diet 2 (roadmap wave 7): cmdk imports @radix-ui/react-dialog for Command.Dialog, which the terminal never
// renders (it uses the inline Command list only). vite.config.ts aliases that one import to src/vendor/radixDialogStub.tsx,
// so the dialog and the layer, focus and scroll-lock code it drags in (about 10 kB gzip) is in no build at all.
/** [the Radix package holding the string, the package that imports it, a string only that package holds]. */
const RADIX_SOURCES: ReadonlyArray<readonly [string, string, string]> = [
  ['@radix-ui/react-dialog', 'cmdk', 'DialogContent'],
  ['@radix-ui/react-dismissable-layer', '@radix-ui/react-dialog', 'dismissableLayer.pointerDownOutside'],
  ['@radix-ui/react-focus-scope', '@radix-ui/react-dialog', 'focusScope.autoFocusOnMount'],
  ['@radix-ui/react-focus-guards', '@radix-ui/react-dialog', 'data-radix-focus-guard'],
]

/** The installed entry file of `pkg` as `importer` would resolve it (pnpm keeps each package's dependencies beside it). */
function installedEntry(pkg: string, importer: string): string {
  const importerDir = importer === 'cmdk' ? path.join(WEB_DIR, 'node_modules', 'cmdk') : path.dirname(installedEntry(importer, 'cmdk'))
  const fromImporter = createRequire(path.join(realpathSync(importerDir), 'package.json'))
  return realpathSync(fromImporter.resolve(pkg))
}

describe('cmdk\'s Radix dialog stack', () => {
  it('is checked for every string the sources below hold, so the markers cannot rot', () => {
    expect([...RADIX_DIALOG_MARKERS].sort()).toEqual(RADIX_SOURCES.map(([, , marker]) => marker).sort())
  })

  it.each(RADIX_SOURCES)('%s still holds its marker in node_modules (so its absence from the build means something)', (pkg, importer, marker) => {
    expect(readFileSync(installedEntry(pkg, importer), 'utf-8').includes(marker), `${pkg} no longer holds ${marker}: update the marker`).toBe(true)
  })

  it.each(RADIX_SOURCES)('%s stays out of the shell and out of every chunk of the build', (pkg, _importer, marker) => {
    expect(shellText.includes(marker), `${pkg} (${marker}) is back in the shell`).toBe(false)
    expect(buildText.includes(marker), `${pkg} (${marker}) is back in the build: is the alias in vite.config.ts still matching cmdk's import?`).toBe(false)
  })

  it('still ships cmdk itself in the shell (the alias removed the dialog, not the command list)', () => {
    expect(shellText.includes('cmdk-list-sizer'), 'cmdk is not in the shell').toBe(true)
  })
})

// Shell diet 3 (roadmap wave 9): two libraries only lazy code needs sat in the shell's vendor chunk. useQueries and its
// QueriesObserver are called by REG and DES only, so the vendor group in vite.config.ts skips those two files and
// they load with those screens. And cmdk's command-score (its fuzzy matcher, about 0.4 kB gzip) is never used,
// because CommandLine passes shouldFilter={false}; vite.config.ts (cmdkScoreStub) swaps its hashed chunk for a
// stub, for cmdk's entry file only. src/vendor/commandScoreStub.test.ts pins what that hashed name means.
/** The folder holding an installed package's modern build, resolved as `fromDir` would (pnpm keeps a package's dependencies beside it). */
function modernBuild(pkg: string, fromDir: string): string {
  const resolved = createRequire(path.join(realpathSync(fromDir), 'package.json')).resolve(pkg)
  return path.dirname(realpathSync(resolved))
}

describe('useQueries and its QueriesObserver', () => {
  const reactQuery = modernBuild('@tanstack/react-query', WEB_DIR)
  const queryCore = modernBuild('@tanstack/query-core', reactQuery)
  const jsFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.js'))

  it('are found in the installed TanStack build (so the vendor group\'s file names and the marker mean something)', () => {
    expect(jsFiles(reactQuery)).toContain('useQueries.js')
    expect(jsFiles(queryCore)).toContain('queriesObserver.js')
  })

  it('hold getQueries() in queriesObserver.js and in no other file of query-core or react-query, so the marker is theirs alone', () => {
    const holders = (
      [['query-core', queryCore], ['react-query', reactQuery]] as const
    ).flatMap(([name, dir]) => jsFiles(dir).filter((f) => readFileSync(path.join(dir, f), 'utf-8').includes('getQueries()')).map((f) => `${name}/${f}`))
    expect(holders).toEqual(['query-core/queriesObserver.js'])
  })
})

// Shell diet 4: useMutation and its MutationObserver are called by JOBS only (screens/jobs/useJobs.ts), so the vendor group
// skips those two files as well (about 0.5 kB gzip). QueryClient's MutationCache and Mutation stay: the client builds them.
describe('useMutation and its MutationObserver', () => {
  const reactQuery = modernBuild('@tanstack/react-query', WEB_DIR)
  const queryCore = modernBuild('@tanstack/query-core', reactQuery)
  const jsFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.js'))
  const vendor = CHUNK_GROUPS.find((g) => g.name === 'vendor')
  const inVendorGroup = (file: string) => vendor?.test.test(file) ?? false

  it('are found in the installed TanStack build, and hold mutateAsync (the build marker) in useMutation.js alone', () => {
    expect(jsFiles(reactQuery)).toContain('useMutation.js')
    expect(jsFiles(queryCore)).toContain('mutationObserver.js')
    const holders = (
      [['query-core', queryCore], ['react-query', reactQuery]] as const
    ).flatMap(([name, dir]) => jsFiles(dir).filter((f) => readFileSync(path.join(dir, f), 'utf-8').includes('mutateAsync')).map((f) => `${name}/${f}`))
    expect(holders).toEqual(['react-query/useMutation.js'])
  })

  it('are left out of the vendor group (they load with JOBS), while the files the shell needs stay in it', () => {
    const base = '/app/node_modules/.pnpm/@tanstack+query-core@5.103.2/node_modules/@tanstack/query-core/build/modern/'
    for (const skipped of ['mutationObserver.js', 'useMutation.js', 'queriesObserver.js', 'useQueries.js']) expect(inVendorGroup(base + skipped), skipped).toBe(false)
    for (const kept of ['mutation.js', 'mutationCache.js', 'queryClient.js', 'queryObserver.js', 'useBaseQuery.js']) expect(inVendorGroup(base + kept), kept).toBe(true)
    expect(inVendorGroup('C:\\app\\node_modules\\.pnpm\\x\\node_modules\\@tanstack\\react-query\\build\\modern\\useMutation.js')).toBe(false)
  })
})

// Shell diet 4: Radix's Slot came in through cmdk's primitive import (src/vendor/radixPrimitiveStub.tsx now stands in).
describe('Radix\'s Slot', () => {
  const MARKER = 'radix.slottable'

  it('still holds its marker in the installed package (so its absence from the build means something)', () => {
    const slot = modernBuild('@radix-ui/react-slot', path.dirname(installedEntry('@radix-ui/react-dialog', 'cmdk')))
    const files = readdirSync(slot).filter((f) => f.endsWith('.mjs'))
    expect(files.some((f) => readFileSync(path.join(slot, f), 'utf-8').includes(MARKER)), `@radix-ui/react-slot no longer holds ${MARKER}: update the marker`).toBe(true)
  })

  it('is in no chunk of the build: the primitive stub stands in', () => {
    expect(buildText.includes(MARKER), 'Radix\'s Slot is back in the build: is the alias in vite.config.ts still matching cmdk\'s import?').toBe(false)
  })
})

describe('cmdk\'s command-score', () => {
  const chunk = readFileSync(path.join(WEB_DIR, 'node_modules', 'cmdk', 'dist', 'chunk-NZJY6EH4.mjs'), 'utf-8')
  /** The first regular expression literal in the chunk: `m=/[\\\/_+.#"@\[\(\{&]/,` in the version measured. */
  const literal = /=(\/(?:[^/\\\n]|\\.)+\/)[gimsuy]*[,;]/.exec(chunk)?.[1]

  it('is found in the installed cmdk by a regular expression it holds (so its absence from the build means something)', () => {
    expect(literal, 'cmdk\'s command-score chunk no longer starts with a regular expression literal: update the search').toBeDefined()
    expect(literal!.length).toBeGreaterThan(10)
  })

  it('is in no chunk of the build: the stub stands in for it', () => {
    expect(buildText.includes(literal!), 'cmdk\'s command-score code is back in the build: is cmdkScoreStub in vite.config.ts still matching cmdk\'s import?').toBe(false)
  })

  it('leaves the command list in the shell (the stub removed the score, not cmdk)', () => {
    expect(shellText.includes('cmdk-list-sizer')).toBe(true)
  })
})

// The print dossier's stylesheet (export/print/print.css) is imported by its runner, so it is a stylesheet of a lazy
// chunk. Stylesheets that index.html links load with first paint, so none of them may hold a dossier rule.
describe('the shell stylesheets', () => {
  /** Every <link rel="stylesheet"> in index.html, as a file in the build. */
  function shellStylesheets(): string[] {
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf-8')
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])
    return links
      .filter((tag) => /\brel\s*=\s*["']stylesheet["']/.test(tag))
      .map((tag) => /\bhref\s*=\s*["']([^"']+)["']/.exec(tag)?.[1])
      .filter((href): href is string => href !== undefined)
      .map((href) => path.join(outDir, href.replace(/^\//, '')))
  }
  const holdsDossier = (text: string) => text.includes('nqt-print-root') || text.includes('.prt-')

  it('are found, so the search below can see the shell\'s css', () => {
    expect(shellStylesheets().length).toBeGreaterThan(0)
  })

  it('hold no print dossier rule', () => {
    for (const file of shellStylesheets()) {
      expect(holdsDossier(readFileSync(file, 'utf-8')), `${path.basename(file)} holds a print dossier rule: it loads with first paint`).toBe(false)
    }
  })

  it('leave the dossier\'s rules to a stylesheet of the lazy chunk (the build holds them somewhere)', () => {
    const assets = path.join(outDir, 'assets')
    const holders = readdirSync(assets).filter((f) => f.endsWith('.css')).filter((f) => holdsDossier(readFileSync(path.join(assets, f), 'utf-8')))
    expect(holders.length).toBeGreaterThan(0)
    const shell = new Set(shellStylesheets().map((f) => path.basename(f)))
    expect(holders.filter((f) => shell.has(f))).toEqual([])
  })
})
