// The desktop self-test spec (e2e/desktop/06-selftest-page.desktop.ts) reuses an existing dist-selftest when it is newer than
// the page's inputs. The page runs web/src/quant, src/perspective, src/bridge and more, so a change anywhere under src, in
// package.json, pnpm-lock.yaml or the goldens must make the build stale (false green otherwise: old code judged "4 of 4").
// Born failing: the first version looked only at the top level of src/selftest, qa/golden and vite.config.ts.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { newestSelftestInput, selftestBuildIsCurrent } from './selftestBuild.ts'

const BASE_S = 1_700_000_000
const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function touch(file: string, seconds: number): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, 'x')
  utimesSync(file, seconds, seconds)
}

/** A scratch terminal folder with web/ and qa/golden, every input at BASE_S and the built page one hour later. */
function site() {
  const terminal = mkdtempSync(path.join(tmpdir(), 'nqt-selftest-build-'))
  scratch.push(terminal)
  const web = path.join(terminal, 'web')
  for (const rel of ['src/selftest/SelfTestApp.tsx', 'src/quant/normal.ts', 'src/perspective/host/wasm.ts', 'src/bridge/index.ts', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml']) {
    touch(path.join(web, rel), BASE_S)
  }
  touch(path.join(terminal, 'qa', 'golden', 'deep', 'g.json'), BASE_S)
  const index = path.join(web, 'dist-selftest', 'index.html')
  touch(index, BASE_S + 3600)
  return { terminal, web, index }
}

describe('selftestBuildIsCurrent', () => {
  it('is current when every input is older than the built page', () => {
    const s = site()
    expect(selftestBuildIsCurrent(s.index, s.web, s.terminal)).toBe(true)
  })

  it.each([
    ['src/quant/normal.ts', 'a quant module the goldens run'],
    ['src/perspective/host/wasm.ts', 'a nested Perspective file'],
    ['src/bridge/index.ts', 'the bridge'],
    ['package.json', 'a package bump'],
    ['pnpm-lock.yaml', 'a lockfile change'],
    ['vite.config.ts', 'the build config'],
  ])('is stale after %s changes (%s)', (rel) => {
    const s = site()
    touch(path.join(s.web, rel), BASE_S + 7200)
    expect(selftestBuildIsCurrent(s.index, s.web, s.terminal)).toBe(false)
  })

  it('is stale after a golden in a nested folder of qa/golden changes', () => {
    const s = site()
    touch(path.join(s.terminal, 'qa', 'golden', 'deep', 'g.json'), BASE_S + 7200)
    expect(selftestBuildIsCurrent(s.index, s.web, s.terminal)).toBe(false)
  })

  it('is stale when the built page is missing', () => {
    const s = site()
    rmSync(s.index)
    expect(selftestBuildIsCurrent(s.index, s.web, s.terminal)).toBe(false)
  })

  it('ignores test files, which the page does not ship', () => {
    const s = site()
    touch(path.join(s.web, 'src', 'quant', 'normal.test.ts'), BASE_S + 7200)
    expect(selftestBuildIsCurrent(s.index, s.web, s.terminal)).toBe(true)
  })
})

describe('newestSelftestInput', () => {
  it('is the newest modification time over src, the top-level files and the goldens, recursively', () => {
    const s = site()
    touch(path.join(s.web, 'src', 'api', 'a', 'b', 'deep.ts'), BASE_S + 500)
    expect(newestSelftestInput(s.web, s.terminal)).toBe((BASE_S + 500) * 1000)
  })
})
