// The Node guard behind ./start.sh (scripts/start.mjs): runs on the old Node it exists to catch, so it is plain
// JavaScript (nodeGuard.mjs) and this test pins its behaviour from the outside.
// web/package.json engines is the single source of the required major; web/.nvmrc must agree with it.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkNode, nodeCandidates, pickCandidate, refusalText, requiredMajor, switchNotice } from './nodeGuard.mjs'

const WEB = fileURLToPath(new URL('../..', import.meta.url))

describe('requiredMajor', () => {
  it('reads the major of an ">=N" range', () => {
    expect(requiredMajor({ node: '>=24' })).toBe(24)
    expect(requiredMajor({ node: '>= 22' })).toBe(22)
    expect(requiredMajor({ node: '  >=26  ' })).toBe(26)
  })

  it('reads web/package.json as it is', () => {
    const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as { engines: { node: string } }
    expect(requiredMajor(pkg.engines)).toBeGreaterThanOrEqual(24)
  })

  it('refuses every other range instead of guessing', () => {
    for (const node of ['^24', '24', '>=24 <26', '>24', '~24.1', '>=24.1.0', '', '24.x']) {
      expect(() => requiredMajor({ node })).toThrow(/engines/)
    }
  })

  it('refuses missing or malformed engines', () => {
    expect(() => requiredMajor(undefined)).toThrow(/engines/)
    expect(() => requiredMajor({})).toThrow(/engines/)
    expect(() => requiredMajor({ node: 24 as unknown as string })).toThrow(/engines/)
  })
})

describe('checkNode', () => {
  const engines = { node: '>=24' }

  it('rejects Node 20 and says what it found and what is required', () => {
    expect(checkNode('v20.20.2', engines)).toEqual({ ok: false, found: '20.20.2', required: 24 })
  })

  it('accepts the required major and anything newer, with or without the leading v', () => {
    expect(checkNode('v24.0.0', engines)).toEqual({ ok: true, found: '24.0.0', required: 24 })
    expect(checkNode('24.21.0', engines).ok).toBe(true)
    expect(checkNode('v25.1.0', engines).ok).toBe(true)
    expect(checkNode('v100.0.0', engines).ok).toBe(true)
  })

  it('rejects the last release below the boundary', () => {
    expect(checkNode('v23.99.99', engines).ok).toBe(false)
  })

  it('rejects a version it cannot read and reports it unchanged', () => {
    expect(checkNode('banana', engines)).toEqual({ ok: false, found: 'banana', required: 24 })
    expect(checkNode('', engines).ok).toBe(false)
  })

  it('takes the requirement from the engines it is given', () => {
    expect(checkNode('v24.5.0', { node: '>=26' })).toEqual({ ok: false, found: '24.5.0', required: 26 })
  })
})

describe('nodeCandidates', () => {
  const home = '/h'
  const dirs: Record<string, string[]> = {
    '/h/.local/share': ['claude', 'node-v22.1.0-linux-x64', 'node-v24.3.0-darwin-arm64', 'node-24', 'node-v24.21.0-darwin-arm64'],
    '/h/.nvm/versions/node': ['v20.1.0', 'v24.10.0', 'v24.9.1'],
  }
  const list = (dir: string): string[] => {
    const found = dirs[dir]
    if (found === undefined) throw new Error(`ENOENT ${dir}`)
    return found
  }

  it('lists the locations in a fixed sequence, newest versions first inside a versioned folder', () => {
    const everything = () => true
    const paths = nodeCandidates({
      home,
      platform: 'darwin',
      env: { NQT_NODE: '/custom/node', NVM_BIN: '/nvm/bin' },
      exists: everything,
      list,
    })
    expect(paths).toEqual([
      '/custom/node',
      '/nvm/bin/node',
      '/h/.local/share/node-v24.21.0-darwin-arm64/bin/node',
      '/h/.local/share/node-v24.3.0-darwin-arm64/bin/node',
      '/h/.local/share/node-v22.1.0-linux-x64/bin/node',
      '/h/.nvm/versions/node/v24.10.0/bin/node',
      '/h/.nvm/versions/node/v24.9.1/bin/node',
      '/h/.nvm/versions/node/v20.1.0/bin/node',
      '/h/.volta/bin/node',
      '/opt/homebrew/opt/node@24/bin/node',
      '/usr/local/opt/node@24/bin/node',
      '/usr/bin/node',
      '/usr/local/bin/node',
    ])
  })

  it('skips missing folders and files without failing', () => {
    const only = new Set(['/usr/local/bin/node', '/h/.volta/bin/node'])
    const paths = nodeCandidates({ home, platform: 'linux', env: {}, exists: (p) => only.has(p), list })
    expect(paths).toEqual(['/h/.volta/bin/node', '/usr/local/bin/node'])
    const none = nodeCandidates({ home: '/nowhere', platform: 'linux', env: {}, exists: () => false, list })
    expect(none).toEqual([])
  })

  it('ignores an empty or unset NQT_NODE and NVM_BIN', () => {
    const paths = nodeCandidates({ home: '/nowhere', platform: 'linux', env: { NQT_NODE: '', NVM_BIN: '' }, exists: () => true, list })
    expect(paths[0]).toBe('/nowhere/.volta/bin/node')
    expect(paths.filter((p) => p === '' || p.endsWith('//node'))).toEqual([])
  })

  it('lists a candidate once, whichever location names it', () => {
    const paths = nodeCandidates({ home: '/nowhere', platform: 'linux', env: { NQT_NODE: '/usr/bin/node' }, exists: () => true, list })
    expect(paths.filter((p) => p === '/usr/bin/node')).toHaveLength(1)
    expect(paths[0]).toBe('/usr/bin/node')
  })

  it('follows the required major in the Homebrew locations', () => {
    const paths = nodeCandidates({ home: '/nowhere', platform: 'darwin', env: {}, required: 26, exists: () => true, list })
    expect(paths).toContain('/opt/homebrew/opt/node@26/bin/node')
    expect(paths).not.toContain('/opt/homebrew/opt/node@24/bin/node')
  })

  it('uses only the named variable on Windows, where start.sh does not run', () => {
    const paths = nodeCandidates({ home, platform: 'win32', env: { NQT_NODE: 'C:/node/node.exe' }, exists: () => true, list })
    expect(paths).toEqual(['C:/node/node.exe'])
  })

  // POSIX only: nodeCandidates joins POSIX paths, and the Node switch is not used on Windows (start.ps1 is).
  describe.skipIf(process.platform === 'win32')('against the real file system', () => {
    let home = ''
    afterEach(() => {
      if (home) rmSync(home, { recursive: true, force: true })
      home = ''
    })

    it('finds a Node under ~/.local/share and skips folders that are absent, reading no file contents', () => {
      home = mkdtempSync(join(tmpdir(), 'nqt-guard-'))
      const bin = join(home, '.local', 'share', 'node-v24.21.0-test', 'bin')
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, 'node'), 'not a real binary')
      const paths = nodeCandidates({ home, platform: 'linux', env: {} })
      expect(paths).toContain(join(bin, 'node'))
      expect(paths.some((p) => p.startsWith(join(home, '.nvm')))).toBe(false)
    })
  })
})

describe('pickCandidate', () => {
  const versions: Record<string, string | null> = {
    '/a': 'v22.1.0',
    '/b': 'v24.3.0',
    '/c': 'v25.0.0',
    '/d': null,
    '/e': 'v24.9.9',
  }
  const probe = (p: string): string | null => versions[p] ?? null

  it('picks the highest major that meets the requirement', () => {
    expect(pickCandidate(['/a', '/b', '/c', '/d', '/e'], probe, 24)).toEqual({ path: '/c', version: '25.0.0' })
  })

  it('keeps the first of equal majors, so an explicit NQT_NODE wins a tie', () => {
    expect(pickCandidate(['/b', '/e'], probe, 24)).toEqual({ path: '/b', version: '24.3.0' })
    expect(pickCandidate(['/e', '/b'], probe, 24)).toEqual({ path: '/e', version: '24.9.9' })
  })

  it('returns null when nothing qualifies, when the list is empty and when every probe fails', () => {
    expect(pickCandidate(['/a', '/d'], probe, 24)).toBeNull()
    expect(pickCandidate([], probe, 24)).toBeNull()
    expect(pickCandidate(['/x', '/y'], () => null, 24)).toBeNull()
  })

  it('probes each path once and treats a probe that throws as a miss', () => {
    const seen: string[] = []
    const picked = pickCandidate(
      ['/boom', '/b'],
      (p) => {
        seen.push(p)
        if (p === '/boom') throw new Error('spawn failed')
        return 'v24.3.0\n'
      },
      24,
    )
    expect(picked).toEqual({ path: '/b', version: '24.3.0' })
    expect(seen).toEqual(['/boom', '/b'])
  })

  it('skips output that is not a version', () => {
    expect(pickCandidate(['/x'], () => 'command not found', 24)).toBeNull()
  })
})

describe('messages', () => {
  it('words the refusal exactly, naming the way out', () => {
    expect(refusalText({ found: '20.20.2', required: 24 })).toBe(
      'Node 20.20.2 is too old: this terminal needs Node 24 or later (web/package.json engines; web/.nvmrc). ' +
        'Under an older Node, pnpm and vitest stop with ERR_UNKNOWN_BUILTIN_MODULE node:sqlite. ' +
        'Install Node 24 (for example with nvm: nvm install 24), or set NQT_NODE to a Node 24 binary and run ./start.sh again.',
    )
  })

  it('keeps the refusal plain ASCII with no dashes of any kind', () => {
    const text = refusalText({ found: '18.0.0', required: 26 })
    expect([...text].filter((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32)).toEqual([])
    expect(text).not.toMatch(/[-\u2010-\u2015\u2212]/)
    expect(text).toContain('Node 26')
  })

  it('announces a switch in one line', () => {
    expect(switchNotice('20.20.2', { path: '/h/.local/share/node-v24.21.0/bin/node', version: '24.21.0' })).toBe(
      'start: Node 20.20.2 is too old for this terminal; using Node 24.21.0 at /h/.local/share/node-v24.21.0/bin/node',
    )
  })
})

describe('web/.nvmrc', () => {
  it('names the same major as engines', () => {
    const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as { engines: { node: string } }
    const nvmrc = readFileSync(join(WEB, '.nvmrc'), 'utf8')
    expect(nvmrc).toMatch(/^\d+\n$/)
    expect(Number(nvmrc.trim())).toBe(requiredMajor(pkg.engines))
  })
})
