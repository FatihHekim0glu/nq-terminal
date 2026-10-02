// scripts/buildStamp.mjs (03 section 7.1): the stamp the build writes into dist, and the backend's reading of it.
// The CLI runs against scratch web folders, so no real dist is touched. The Python half runs the backend's own
// build_stamp.py over the same scratch folder, so the two implementations of the source list cannot drift apart:
// a changed source, or a changed openapi.json, must give `stale` there.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const TERMINAL = join(WEB, '..')
const SCRIPT = join(WEB, 'scripts', 'buildStamp.mjs')
const PYTHON = join(TERMINAL, '..', '.venv', 'Scripts', 'python.exe')
const BASE_MS = 1_700_000_000_000
const HEX64 = /^[0-9a-f]{64}$/

const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

interface Site {
  readonly web: string
  readonly dist: string
  readonly contract: string
}

function put(file: string, text: string, ms: number): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  utimesSync(file, new Date(ms), new Date(ms))
}

/** A web folder with a source of every kind the list names, all at BASE_MS, a built dist and a contract. */
function site(): Site {
  const root = mkdtempSync(join(tmpdir(), 'nqt-stamp-'))
  scratch.push(root)
  const web = join(root, 'web')
  for (const name of ['index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json']) {
    put(join(web, name), name, BASE_MS)
  }
  put(join(web, 'src', 'main.tsx'), 'main', BASE_MS)
  put(join(web, 'src', 'a', 'b.ts'), 'b', BASE_MS)
  put(join(web, 'public', 'favicon.svg'), '<svg/>', BASE_MS)
  put(join(web, 'dist', 'index.html'), '<html/>', BASE_MS + 5_000)
  const contract = join(root, 'contract', 'openapi.json')
  put(contract, '{"openapi":"3.1.0"}\n', BASE_MS)
  return { web, dist: join(web, 'dist'), contract }
}

function stamp(s: Site, ...extra: string[]): { status: number | null; err: string } {
  const run = spawnSync(process.execPath, [SCRIPT, '--web', s.web, ...extra, s.dist, s.contract], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  return { status: run.status, err: run.stderr }
}

function read(s: Site): { v: number; newest_source_mtime_ms: number; openapi_sha256: string } {
  return JSON.parse(readFileSync(join(s.dist, 'build-stamp.json'), 'utf8'))
}

describe('build-stamp.json', () => {
  it('holds the version, the newest source time in whole milliseconds and the full sha256 of the contract', () => {
    const s = site()
    expect(stamp(s).status).toBe(0)
    const doc = read(s)
    expect(Object.keys(doc)).toEqual(['v', 'newest_source_mtime_ms', 'openapi_sha256'])
    expect(doc.v).toBe(1)
    expect(doc.newest_source_mtime_ms).toBe(BASE_MS)
    expect(doc.openapi_sha256).toMatch(HEX64)
    expect(doc.openapi_sha256).toBe(createHash('sha256').update(readFileSync(s.contract)).digest('hex'))
  })

  it('is one LF-terminated line', () => {
    const s = site()
    stamp(s)
    const text = readFileSync(join(s.dist, 'build-stamp.json'), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.trimEnd()).not.toMatch(/[\r\n]/)
  })

  it('follows the newest file of the source list: src, top-level files, public and the launch page', () => {
    const cases: Array<[string, string]> = [
      ['src/deep/new.ts', 'src'],
      ['package.json', 'top level'],
      ['public/logo.svg', 'public'],
      ['session.html', 'launch page'],
    ]
    for (const [name, what] of cases) {
      const s = site()
      put(join(s.web, name), 'x', BASE_MS + 12_345)
      stamp(s)
      expect(read(s).newest_source_mtime_ms, what).toBe(BASE_MS + 12_345)
    }
  })

  it('ignores test and gallery files, and files outside the list', () => {
    const s = site()
    put(join(s.web, 'src', 'a', 'b.test.ts'), 'x', BASE_MS + 99_000)
    put(join(s.web, 'src', 'a', 'c.gallery.tsx'), 'x', BASE_MS + 99_000)
    put(join(s.web, 'README.md'), 'x', BASE_MS + 99_000)
    put(join(s.web, 'dist', 'assets', 'chunk.js'), 'x', BASE_MS + 99_000)
    stamp(s)
    expect(read(s).newest_source_mtime_ms).toBe(BASE_MS)
  })

  it('refuses to write when there is no build folder, and says so', () => {
    const s = site()
    rmSync(s.dist, { recursive: true, force: true })
    const run = stamp(s)
    expect(run.status).toBe(1)
    expect(run.err).toMatch(/no build folder/)
    expect(existsSync(join(s.dist, 'build-stamp.json'))).toBe(false)
  })
})

function backend(s: Site): { newest: number; status: string } {
  const code = [
    'import json, sys',
    'from pathlib import Path',
    'from nq_terminal.desktop.build_stamp import dist_status, newest_source_mtime_ms',
    'web, contract = Path(sys.argv[1]), Path(sys.argv[2])',
    'print(json.dumps({"newest": newest_source_mtime_ms(web), "status": dist_status(web, contract)}))',
  ].join('\n')
  const run = spawnSync(PYTHON, ['-X', 'utf8', '-c', code, s.web, s.contract], {
    cwd: join(TERMINAL, 'backend'),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  })
  expect(run.status, run.stderr).toBe(0)
  return JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '{}')
}

describe.runIf(existsSync(PYTHON))('the backend reads the stamp', () => {
  it('finds the same newest source time as the stamp holds, and calls a fresh build current', () => {
    const s = site()
    put(join(s.web, 'src', 'later.ts'), 'x', BASE_MS + 777)
    stamp(s)
    const seen = backend(s)
    expect(seen.newest).toBe(read(s).newest_source_mtime_ms)
    expect(seen.status).toBe('current')
  })

  it('says stale when a source is newer than the stamp', () => {
    const s = site()
    stamp(s)
    put(join(s.web, 'src', 'main.tsx'), 'edited', BASE_MS + 60_000)
    expect(backend(s).status).toBe('stale')
  })

  it('says stale when openapi.json changed after the build', () => {
    const s = site()
    stamp(s)
    writeFileSync(s.contract, '{"openapi":"3.1.0","info":{"title":"changed"}}\n')
    expect(backend(s).status).toBe('stale')
  })

  it('says stale without a stamp, and missing without a build', () => {
    const s = site()
    expect(backend(s).status).toBe('stale')
    rmSync(s.dist, { recursive: true, force: true })
    expect(backend(s).status).toBe('missing')
  })
})
