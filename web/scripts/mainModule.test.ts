// The main-module guard of the web scripts compares real paths (0.3.1 part 2). Node gives import.meta.url as the real path,
// while process.argv[1] keeps the path the caller typed: started through the C: to E: junction that holds the lab, the two
// never matched as strings, so `gen:api` and `buildStamp` exited 0 without writing anything. Each script is started here through
// a junction planted under D:/dev/tmp and must still run; a same-named file that is not recognised must say so and exit 2.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { isMainModule } from './mainModule.mjs'

const WEB = join(import.meta.dirname, '..')
const ROOT = 'D:/dev/tmp/web-main-guard-tests'
const SCRATCH = join(ROOT, `run-${process.pid}-${Date.now()}`)

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

/** A junction to the real web folder, the way C:\Users\...\nq-lab reaches E:\projects\nq-lab. */
function webThroughJunction(): string {
  const link = join(SCRATCH, 'web-link')
  if (existsSync(link)) return link
  mkdirSync(SCRATCH, { recursive: true })
  symlinkSync(WEB, link, 'junction')
  return link
}

/** Each of these starts a node process; under a full-width suite run one can take longer than the 5 s default. */
const SPAWN_TEST_TIMEOUT_MS = 120_000

const node = (args: readonly string[]) => spawnSync(process.execPath, [...args], { encoding: 'utf8', windowsHide: true, timeout: 120_000 })

describe('a script started through a junction still runs', () => {
  it('buildStamp.mjs writes its stamp', () => {
    const link = webThroughJunction()
    const web = join(SCRATCH, 'web')
    const dist = join(SCRATCH, 'dist')
    mkdirSync(join(web, 'src'), { recursive: true })
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(web, 'src', 'a.ts'), 'export {}\n')
    writeFileSync(join(SCRATCH, 'openapi.json'), '{}\n')
    const run = node([join(link, 'scripts', 'buildStamp.mjs'), '--web', web, dist, join(SCRATCH, 'openapi.json')])
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(existsSync(join(dist, 'build-stamp.json')), 'the stamp was written').toBe(true)
    expect(JSON.parse(readFileSync(join(dist, 'build-stamp.json'), 'utf8')).v).toBe(1)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('gen-api.mjs --check says whether the API types are in sync (it exited silently before)', () => {
    const link = webThroughJunction()
    const run = node([join(link, 'src', 'api', 'codegen', 'gen-api.mjs'), '--check'])
    expect(run.stdout + run.stderr).toMatch(/API types in sync with the contract|stale generated API files/)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('bundleCheck.ts prints its usage and exits 2 with no folder (it exited 0 silently before)', () => {
    const link = webThroughJunction()
    const run = node([join(link, 'scripts', 'bundleCheck.ts')])
    expect(run.stderr).toMatch(/usage: node scripts\/bundleCheck\.ts/)
    expect(run.status).toBe(2)
  }, SPAWN_TEST_TIMEOUT_MS)
})

describe('isMainModule', () => {
  it('recognises the file through a junction, with any letter case', () => {
    const link = webThroughJunction()
    const real = join(WEB, 'scripts', 'mainModule.mjs')
    const typed = join(link, 'scripts', 'mainModule.mjs')
    expect(isMainModule(pathToFileURL(real).href, { argv1: typed })).toBe(true)
    expect(isMainModule(pathToFileURL(real).href, { argv1: typed.toUpperCase() })).toBe(true)
  })

  it('is false when another file was started, or when there is no argv', () => {
    const seen: string[] = []
    const url = pathToFileURL(join(WEB, 'scripts', 'mainModule.mjs')).href
    expect(isMainModule(url, { argv1: join(WEB, 'scripts', 'buildStamp.mjs'), onMismatch: (line) => seen.push(line) })).toBe(false)
    expect(isMainModule(url, { argv1: undefined })).toBe(false)
    expect(seen).toEqual([])
  })

  it('says so, and the exit code is 2, when a same-named file was started but is not the module', () => {
    const seen: string[] = []
    const url = pathToFileURL(join(WEB, 'scripts', 'mainModule.mjs')).href
    expect(isMainModule(url, { argv1: join(SCRATCH, 'elsewhere', 'mainModule.mjs'), onMismatch: (line) => seen.push(line) })).toBe(false)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/mainModule\.mjs.*not recognised as the main module/)
  })
})
