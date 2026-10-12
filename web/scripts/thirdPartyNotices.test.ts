// scripts/thirdPartyNotices.mjs (D7.4): the notices file of the page, built from pnpm-lock.yaml and the packages' own licence files,
// and the check that fails when the file and the lockfile part ways. The generator is plain Node, so it is loaded with a dynamic
// import (no type declaration file to keep) and exercised with small lockfiles and package folders made in a scratch directory.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = join(WEB, 'scripts', 'thirdPartyNotices.mjs')
const NOTICES = join(WEB, 'public', 'third-party-notices.txt')

interface Pkg { name: string; version: string }
interface Collected { name: string; version: string; license: string; repository: string; texts: string[]; note: string }
interface Check { ok: boolean; missing: string[]; extra: string[] }
interface Generator {
  productionPackages(lock: string): Pkg[]
  renderNotices(input: { heading: string; source: string; command: string; packages: Collected[]; extras: Array<{ name: string; license: string; text: string }> }): string
  checkNotices(expected: Pkg[], notices: string): Check
  collectPackage(storeRoot: string, pkg: Pkg): Collected
  findStore(nodeModules: string): string | null
}
const gen = (await import(/* @vite-ignore */ pathToFileURL(SCRIPT).href)) as Generator

const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    dependencies:
      '@scope/direct':
        specifier: 1.0.0
        version: 1.0.0
      react-dom:
        specifier: 19.3.0
        version: 19.3.0(react@19.3.0)
      react:
        specifier: 19.3.0
        version: 19.3.0
    devDependencies:
      vitest:
        specifier: 5.0.2
        version: 5.0.2

packages:

  '@scope/direct@1.0.0':
    resolution: {integrity: sha512-aaa}

  leaf@2.1.0:
    resolution: {integrity: sha512-bbb}

  react-dom@19.3.0:
    resolution: {integrity: sha512-ccc}

  react@19.3.0:
    resolution: {integrity: sha512-ddd}

  scheduler@0.27.0:
    resolution: {integrity: sha512-eee}

  vitest@5.0.2:
    resolution: {integrity: sha512-fff}

  dev-only@3.0.0:
    resolution: {integrity: sha512-ggg}

snapshots:

  '@scope/direct@1.0.0':
    dependencies:
      leaf: 2.1.0

  leaf@2.1.0: {}

  react-dom@19.3.0(react@19.3.0):
    dependencies:
      react: 19.3.0
      scheduler: 0.27.0

  react@19.3.0: {}

  scheduler@0.27.0: {}

  vitest@5.0.2:
    dependencies:
      dev-only: 3.0.0

  dev-only@3.0.0: {}
`

const SHIPPED: Pkg[] = [
  { name: '@scope/direct', version: '1.0.0' },
  { name: 'leaf', version: '2.1.0' },
  { name: 'react', version: '19.3.0' },
  { name: 'react-dom', version: '19.3.0' },
  { name: 'scheduler', version: '0.27.0' },
]

function collected(p: Pkg, text = 'MIT text'): Collected {
  return { ...p, license: 'MIT', repository: '', texts: [text], note: '' }
}

function render(packages: Pkg[]): string {
  return gen.renderNotices({ heading: 'Test notices', source: 'pnpm-lock.yaml', command: 'node x.mjs', packages: packages.map((p) => collected(p)), extras: [] })
}

const scratch = mkdtempSync(join(process.env.TEMP ?? tmpdir(), 'notices-test-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('productionPackages (the packages the page ships, from the lockfile)', () => {
  it('walks the importer dependencies and their snapshots, strips peer suffixes, and leaves out dev dependencies and what only they need', () => {
    expect(gen.productionPackages(LOCK)).toEqual(SHIPPED)
  })

  it('lists a package once however many peer variants the lockfile holds', () => {
    const twice = LOCK.replace('  react@19.3.0: {}', "  react@19.3.0: {}\n\n  react@19.3.0(x@1.0.0): {}")
    expect(gen.productionPackages(twice).filter((p) => p.name === 'react')).toHaveLength(1)
  })

  it('reads the real lockfile: the five libraries HELP names are all there', () => {
    const names = gen.productionPackages(readFileSync(join(WEB, 'pnpm-lock.yaml'), 'utf8')).map((p) => p.name)
    for (const name of ['react', 'react-dom', 'dockview-react', 'cmdk', 'zustand', '@tanstack/react-query', 'lightweight-charts', '@fontsource/pt-mono']) {
      expect(names).toContain(name)
    }
    expect(names).not.toContain('vitest')
  })
})

describe('checkNotices (the notices against the lockfile)', () => {
  it('passes when the notices list exactly the lockfile packages', () => {
    expect(gen.checkNotices(SHIPPED, render(SHIPPED))).toEqual({ ok: true, missing: [], extra: [] })
  })

  it('born failing: a lockfile package missing from the notices fails, and names it', () => {
    const without = SHIPPED.filter((p) => p.name !== 'leaf')
    const result = gen.checkNotices(SHIPPED, render(without))
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['leaf 2.1.0'])
  })

  it('a package that left the lockfile but stays in the notices fails', () => {
    const result = gen.checkNotices(SHIPPED.filter((p) => p.name !== 'scheduler'), render(SHIPPED))
    expect(result.ok).toBe(false)
    expect(result.extra).toEqual(['scheduler 0.27.0'])
  })

  it('a version bump in the lockfile fails (the old version is extra, the new one missing)', () => {
    const bumped = SHIPPED.map((p) => (p.name === 'react' ? { ...p, version: '19.4.0' } : p))
    const result = gen.checkNotices(bumped, render(SHIPPED))
    expect(result).toEqual({ ok: false, missing: ['react 19.4.0'], extra: ['react 19.3.0'] })
  })

  it('does not count the extra entries (font, loader) against the lockfile', () => {
    const text = gen.renderNotices({
      heading: 'h', source: 's', command: 'c', packages: SHIPPED.map((p) => collected(p)),
      extras: [{ name: 'Bergoom font', license: 'OFL-1.1', text: 'OFL text' }],
    })
    expect(text).toContain('Bergoom font')
    expect(gen.checkNotices(SHIPPED, text).ok).toBe(true)
  })

  it('a notices file with no package index at all fails every package', () => {
    const result = gen.checkNotices(SHIPPED, 'nothing here\n')
    expect(result.ok).toBe(false)
    expect(result.missing).toHaveLength(SHIPPED.length)
  })
})

describe('renderNotices', () => {
  it('prints each distinct licence text once and points each package at it', () => {
    const text = gen.renderNotices({
      heading: 'h', source: 's', command: 'c',
      packages: [collected(SHIPPED[0]), collected(SHIPPED[1]), collected(SHIPPED[2], 'Copyright B')],
      extras: [],
    })
    expect(text.split('MIT text').length - 1).toBe(1)
    expect(text).toContain('Copyright B')
  })

  it('says so for a package whose files hold no licence text, instead of leaving it out', () => {
    const bare = { ...collected(SHIPPED[0]), texts: [], note: 'no licence file in the package' }
    const text = gen.renderNotices({ heading: 'h', source: 's', command: 'c', packages: [bare], extras: [] })
    expect(text).toContain('no licence file in the package')
    expect(gen.checkNotices([SHIPPED[0]], text).ok).toBe(true)
  })

  it('stores LF line endings only, whatever the licence files used', () => {
    const crlf = { ...collected(SHIPPED[0]), texts: ['line one\r\nline two\r\n'] }
    const text = gen.renderNotices({ heading: 'h', source: 's', command: 'c', packages: [crlf], extras: [] })
    expect(text).not.toContain('\r')
    expect(text).toContain('line one\nline two')
  })
})

describe('collectPackage and findStore (the licence files of an installed package)', () => {
  function makeStore(): string {
    const root = join(scratch, `store-${Math.random().toString(36).slice(2)}`)
    const dir = join(root, '.pnpm', 'leaf@2.1.0', 'node_modules', 'leaf')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'leaf', version: '2.1.0', license: 'ISC', repository: { url: 'git+https://example.invalid/leaf.git' } }))
    writeFileSync(join(dir, 'LICENSE'), 'Leaf licence text\r\n')
    writeFileSync(join(dir, 'NOTICE.md'), 'Leaf notice')
    writeFileSync(join(dir, 'README.md'), 'not a licence')
    return root
  }

  it('reads the declared licence, the repository, and every LICENSE and NOTICE file', () => {
    const root = makeStore()
    const found = gen.collectPackage(gen.findStore(root) ?? '', { name: 'leaf', version: '2.1.0' })
    expect(found.license).toBe('ISC')
    expect(found.repository).toBe('https://example.invalid/leaf')
    expect(found.texts).toEqual(['Leaf licence text', 'Leaf notice'])
    expect(found.note).toBe('')
  })

  it('reads the legacy licenses array and the { type } object form', () => {
    const root = makeStore()
    const dir = join(root, '.pnpm', 'old@1.0.0', 'node_modules', 'old')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'old', version: '1.0.0', licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }))
    expect(gen.collectPackage(gen.findStore(root) ?? '', { name: 'old', version: '1.0.0' }).license).toBe('MIT OR Apache-2.0')
  })

  it('throws for a package that is not installed, so a half-installed tree cannot write half a notice', () => {
    const root = makeStore()
    expect(() => gen.collectPackage(gen.findStore(root) ?? '', { name: 'missing', version: '9.9.9' })).toThrow(/missing@9\.9\.9/)
  })

  it('finds no store in a folder without .pnpm', () => {
    expect(gen.findStore(join(scratch, 'no-such-folder'))).toBeNull()
  })
})

describe('the command line', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

  it('--check exits 1 with the missing package named when the notices lack a lockfile package', () => {
    const lock = join(scratch, 'cli.lock.yaml')
    const notices = join(scratch, 'cli.notices.txt')
    writeFileSync(lock, LOCK)
    writeFileSync(notices, render(SHIPPED.filter((p) => p.name !== 'leaf')))
    const result = run('--check', '--lock', lock, '--notices', notices)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('leaf 2.1.0')
  })

  it('--check exits 0 when they match', () => {
    const lock = join(scratch, 'ok.lock.yaml')
    const notices = join(scratch, 'ok.notices.txt')
    writeFileSync(lock, LOCK)
    writeFileSync(notices, render(SHIPPED))
    expect(run('--check', '--lock', lock, '--notices', notices).status).toBe(0)
  })

  it('--check exits 2 when the notices file is missing: a check that cannot run never passes', () => {
    const lock = join(scratch, 'two.lock.yaml')
    writeFileSync(lock, LOCK)
    expect(run('--check', '--lock', lock, '--notices', join(scratch, 'absent.txt')).status).toBe(2)
  })
})

describe('the shipped notices file', () => {
  it('matches web/pnpm-lock.yaml (regenerate with: pnpm --dir web notices)', () => {
    const lock = readFileSync(join(WEB, 'pnpm-lock.yaml'), 'utf8')
    const result = gen.checkNotices(gen.productionPackages(lock), readFileSync(NOTICES, 'utf8'))
    expect(result).toEqual({ ok: true, missing: [], extra: [] })
  })

  it('lists the fonts the page vendors and the libraries HELP names, with their licences', () => {
    const text = readFileSync(NOTICES, 'utf8')
    expect(text).toContain('Bergoom')
    expect(text).toContain('SIL OPEN FONT LICENSE')
    expect(text).toContain('Apache License')
    expect(text).toMatch(/^- lightweight-charts 5\.2\.1 \| Apache-2\.0/m)
  })

  it('has no carriage returns and no em or en dashes of our own writing in its header', () => {
    const text = readFileSync(NOTICES, 'utf8')
    expect(text).not.toContain('\r')
    expect(text.split('\n').slice(0, 12).join('\n')).not.toMatch(/[\u2013\u2014]/)
  })
})
