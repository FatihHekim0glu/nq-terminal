// The self-test page is a dev and proof tool: no file the production build reads may import it (bundleCheck.ts fails a built
// production bundle that holds it; this scan fails the import itself), and the page's own use of the test-reference quant
// modules stays in one file (src/quant/importGuard.test.ts forbids every other production file from naming them).
import { describe, expect, it } from 'vitest'

/** Every ts, tsx and html file under src, as text, keyed by its path from this folder (`../chrome/Workspace.tsx`). */
const SOURCES = import.meta.glob('../**/*.{ts,tsx,html}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const TEST_FILE = /\.test\.tsx?$/

const outside = Object.entries(SOURCES).filter(([file]) => file.startsWith('../') && !file.startsWith('../selftest/') && !TEST_FILE.test(file))
const own = Object.entries(SOURCES)
  .filter(([file]) => file.startsWith('./') && !TEST_FILE.test(file))
  .map(([file, text]) => [file.slice('./'.length), text] as const)

describe('the self-test page stays out of the production build', () => {
  it('reads the whole tree, so an empty scan cannot pass', () => {
    expect(outside.length).toBeGreaterThan(300)
    expect(own.map(([file]) => file)).toEqual(expect.arrayContaining(['index.html', 'main.tsx', 'run.ts', 'report.ts', 'session.ts']))
  })

  it('no file outside src/selftest names it, test files aside', () => {
    expect(outside.filter(([, text]) => /selftest/i.test(text)).map(([file]) => file)).toEqual([])
  })

  it('born failing: the scan finds a planted import', () => {
    const plants: readonly string[] = ["void import('./selftest/boot')", "import { x } from '../selftest/run'", 'window.__selftest = {}']
    for (const planted of plants) expect(/selftest/i.test(planted), planted).toBe(true)
  })
})

describe('the page reaches the quant test references through quant.load.ts only', () => {
  const NAMES = /(?:linalg|cluster|trials|neffReference|expectationReference)['"]/

  it('names them in one file, imported dynamically and never statically', () => {
    expect(own.filter(([, text]) => NAMES.test(text)).map(([file]) => file)).toEqual(['quant.load.ts'])
    const text = own.find(([file]) => file === 'quant.load.ts')?.[1] ?? ''
    expect(text).not.toMatch(/^\s*import\s[^(]*from\s+['"][^'"]*(linalg|cluster|trials|neffReference)['"]/m)
    expect(text).toMatch(/import\(\s*['"]\.\.\/quant\/linalg['"]\s*\)/)
  })
})
