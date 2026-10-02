// scripts/start/ensureRunDir.ts: makes (and with --fresh empties) the fixture backend's own state folder, and only ever a
// run folder (node_modules/.tmp/e2e-<name>). Born failing: a path anywhere else is refused and left untouched.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./ensureRunDir.ts', import.meta.url))
const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/** A scratch project whose node_modules/.tmp holds the run folders, as the real one does. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'nqt-rundir-'))
  scratch.push(root)
  mkdirSync(join(root, 'node_modules', '.tmp'), { recursive: true })
  return join(root, 'node_modules', '.tmp')
}

function run(...args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  return { status: result.status, stderr: result.stderr }
}

describe('ensureRunDir', () => {
  it('creates a run folder, and leaves an existing one and its contents alone', () => {
    const tmp = project()
    const folder = join(tmp, 'e2e-state-4273')
    expect(run(folder).status).toBe(0)
    expect(existsSync(folder)).toBe(true)
    writeFileSync(join(folder, 'kept.txt'), 'x')
    expect(run(folder).status).toBe(0)
    expect(readdirSync(folder)).toEqual(['kept.txt'])
  })

  it('--fresh empties what a previous run left behind', () => {
    const tmp = project()
    const folder = join(tmp, 'e2e-state-4273')
    mkdirSync(join(folder, 'cache'), { recursive: true })
    writeFileSync(join(folder, 'cache', 'old.json'), '{}')
    expect(run('--fresh', folder).status).toBe(0)
    expect(existsSync(folder)).toBe(true)
    expect(readdirSync(folder)).toEqual([])
  })

  it('refuses anything that is not node_modules/.tmp/e2e-<name>, and touches nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'nqt-rundir-'))
    scratch.push(root)
    const elsewhere = join(root, 'precious')
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'file.txt'), 'x')
    const wrongName = join(project(), 'state')
    for (const target of [elsewhere, wrongName, root]) {
      const result = run('--fresh', target)
      expect(result.status, target).toBe(1)
      expect(result.stderr).toMatch(/not a run folder/)
    }
    expect(readdirSync(elsewhere)).toEqual(['file.txt'])
    expect(existsSync(wrongName)).toBe(false)
  })
})
