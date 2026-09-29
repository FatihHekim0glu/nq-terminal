// The first-paint shell diet (roadmap wave 6, SHELL-DIET): code that first paint does not need loads through
// a dynamic import, and the shell's gzip ceiling is pinned close to its measured size so later waves cannot
// grow it back unnoticed. One real production build; each moved piece is found by a string only it holds:
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
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUNDLE_BUDGET, analyseBundle, type BundleReport } from './bundleCheck.ts'

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The shell ceiling, in gzip bytes: what the diet reached (125,239 B, from 132,131 B) plus 1.5 kB of room.
 * BUNDLE_BUDGET.shellGzip in bundleCheck.ts must not be raised above it. To grow the shell on purpose, move
 * something else out first, or raise this number in the same change as the feature that needs it, with the
 * reason in the commit. A change that cuts the shell further can lower both.
 */
const PINNED_SHELL_CEILING = 126_800
/** The gallery build's shell, which is about 0.8 kB larger (126,064 B measured), plus the same 1.5 kB. */
const PINNED_GALLERY_SHELL_CEILING = 127_600

/** [what it is, a string only that code holds]. Each is reached only through a dynamic import. */
const ON_DEMAND: ReadonlyArray<readonly [string, string]> = [
  ['the panels\' parts copy: export, related menu, quote, field, chart (copy/panelParts.ts)', 'Saved {n} rows as {file}.'],
  ['the screen data hooks (api/queries.screens.ts)', '/api/market/paper-rolls'],
  ['the live stream client (api/liveStream.ts, api/useLiveStream.ts)', 'stallHeartbeats'],
  ['the key map overlay (chrome/KeyToolbar.overlay.tsx)', 'nqt-keymap-title'],
  ['the HELP screen copy and drawn keyboard (copy/help.ts)', 'Drawn keyboard: the terminal keys in their colours'],
  ['the event tape (chrome/EventTape.tsx, off by default)', 'tape-lines'],
  ['the panels\' roving focus code (chrome/WorkspaceFocus.ts)', 'data-roving-vertical-list'],
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
