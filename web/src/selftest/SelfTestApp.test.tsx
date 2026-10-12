// The goldens table must survive the report the page really holds: window.__selftest is a JSON copy, and JSON writes a
// golden's Infinity error (a crashed or NaN golden, the failure JavaScriptCore is likeliest to show) as null. A throw here
// unmounts the whole page, so the start button never appears and the job loses the very report it exists to collect.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import SelfTestApp, { GoldenTable } from './SelfTestApp.tsx'
import { GOLDEN_NAMES, type SelfTestReport } from './report.ts'
import { changed, passingReport } from './report.testUtil.ts'

// Vitest stubs stylesheets (vite.config.ts css.include), so the file is read from disk with the Node built-in, typed by hand as
// the app tsconfig carries browser types only (see export/print/print.css.test.ts).
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as { readFileSync(path: URL, encoding: 'utf8'): string }
const selftestCss = fs.readFileSync(new URL('./selftest.css', import.meta.url), 'utf8')

function publishedCopy(report: SelfTestReport): SelfTestReport {
  return JSON.parse(JSON.stringify(report)) as SelfTestReport
}

describe('GoldenTable', () => {
  it('shows a worst error that JSON turned into null instead of throwing', () => {
    const broken = changed(passingReport(), (r) => { r.goldens[0]!.maxRelativeError = Number.POSITIVE_INFINITY; r.goldens[0]!.passed = false })
    const copy = publishedCopy(broken)
    expect(copy.goldens[0]!.maxRelativeError).toBeNull()
    const html = renderToStaticMarkup(<GoldenTable report={copy} />)
    expect(html).toContain('not finite')
    for (const name of GOLDEN_NAMES) expect(html).toContain(name)
  })

  it('still writes a finite error in exponent form', () => {
    const html = renderToStaticMarkup(<GoldenTable report={passingReport()} />)
    expect(html).toContain('1.00e-14')
  })
})

// The first desktop report with undecided checks named two: aria-label on a bare <pre> (axe: aria-prohibited-attr, a label is not
// well supported on an element with no role) and the pane text under dockview's floating-group host (axe: colour contrast cannot
// be decided under an overlapping element). Both are removed at the cause, so the page needs no axe allowlist entry.
describe('the page markup axe has to decide', () => {
  it('gives the labelled report block a role that takes a label', () => {
    const html = renderToStaticMarkup(<SelfTestApp autoGesture={false} />)
    expect(html).toMatch(/<pre[^>]*role="region"[^>]*aria-label="The report as JSON"|<pre[^>]*aria-label="The report as JSON"[^>]*role="region"/)
  })

  it('takes the empty floating-group host of the dockview probe out of the page, so it overlaps nothing', () => {
    expect(selftestCss).toMatch(/\.selftest-dock\s+\.dv-floating-overlay-host\s*\{[^}]*display:\s*none/)
  })
})
