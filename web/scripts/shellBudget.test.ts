// The first-paint shell diet (roadmap wave 6, SHELL-DIET; wave 7, SHELL-DIET-2): code that first paint does not
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
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUNDLE_BUDGET, RADIX_DIALOG_MARKERS, analyseBundle, type BundleReport } from './bundleCheck.ts'

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The shell ceiling, in gzip bytes: what shell diet 2 reached (115,167 B, from 125,385 B after the wave 6 diet and
 * 132,131 B before it) plus 1.5 kB of room. BUNDLE_BUDGET.shellGzip in bundleCheck.ts must not be raised above it.
 * To grow the shell on purpose, move something else out first, or raise this number in the same change as the
 * feature that needs it, with the reason in the commit. A change that cuts the shell further can lower both.
 */
const PINNED_SHELL_CEILING = 116_700
/** The gallery build's shell, which is about 0.8 kB larger (116,005 B measured), plus the same 1.5 kB. */
const PINNED_GALLERY_SHELL_CEILING = 117_600

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
]

/** Strings the shell must still hold: they prove the search below can find shell code at all. */
const IN_SHELL: ReadonlyArray<readonly [string, string]> = [
  ['the health poll (api/queries.ts)', '/api/health'],
  ['the workspace loading copy (copy/workspace.ts)', 'The workspace is still loading'],
  ['the reserved F-key lines (copy/navKeys.ts)', 'F5 would reload'],
]

const temps: string[] = []
let report: BundleReport
let shellText = ''
let buildText = ''

beforeAll(() => {
  const out = mkdtempSync(path.join(tmpdir(), 'nqt-shell-'))
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
