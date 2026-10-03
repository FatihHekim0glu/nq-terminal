// The docs cannot drift from the code unnoticed (roadmap wave 13, QW-DOCS). What is pinned here:
//   1. docs/ARCHITECTURE.md section 4.1 lists exactly the paths of contract/openapi.json, one GET line each, between the
//      two endpoint-index markers. A path added to, or dropped from, the contract fails this test until the index says so
//      (and a planted index that misses one path is reported, with the hint to update section 4.1).
//   2. Every `pnpm` command the README and ARCHITECTURE show names a script that web/package.json has (`e2e:offline`
//      included: the script name may hold digits).
//   3. ARCHITECTURE section 1 quotes the versions web/package.json pins, names Bergoom, and names none of the fonts and
//      libraries the terminal dropped (tinykeys, JetBrains Mono, Inter, Space Grotesk); the README's React, TypeScript, Vite
//      and pnpm versions are the pinned ones.
//   4. The README keeps the launcher, demo and offline E2E story (./start.sh doctor, e2e:offline, the command words, the go
//      link rule), lists the mnemonics of commands/registry.ts in order, and counts paths, mnemonics and metrics as the
//      contract, the registry and the catalogue do; every file it links or names exists.
//   5. docs/TESTING.md names existing specs; docs/media is documented file by file, every screenshot is on the page, each
//      WebP stays small and the folder stays under 6 MB; UI_SPEC points at the layouts file where it lives.
// Plain node: node:fs reads, paths from import.meta.url, no DOM.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const ROOT = path.resolve(WEB, '..')

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), 'utf8')
/** An assertion that names what was looked for and in which document, without printing the whole document on failure. */
const mentions = (document: string, label: string, needle: string): void => {
  expect(document.includes(needle), `${label} should mention ${needle}`).toBe(true)
}
const README = read('README.md')
const TESTING = read('docs', 'TESTING.md')
const CATALOG = read('docs', 'ANALYTICS_CATALOG.md')
const ARCHITECTURE = read('docs', 'ARCHITECTURE.md')
const UI_SPEC = read('docs', 'UI_SPEC.md')
const MEDIA_README = read('docs', 'media', 'README.md')
const PACKAGE = JSON.parse(readFileSync(path.join(WEB, 'package.json'), 'utf8')) as {
  readonly packageManager: string
  readonly scripts: Readonly<Record<string, string>>
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}
const OPENAPI = JSON.parse(read('contract', 'openapi.json')) as { readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>> }
const CONTRACT_PATHS = Object.keys(OPENAPI.paths)

const INDEX_START = '<!-- endpoint-index:start -->'
const INDEX_END = '<!-- endpoint-index:end -->'
const INDEX_HINT = 'update docs/ARCHITECTURE.md section 4.1'

interface IndexLine {
  readonly method: string
  readonly path: string
  readonly consumers: string
}

/** The text between the two markers; throws when a marker is missing, appears twice or the order is wrong. */
function indexBlock(markdown: string): string {
  const starts = markdown.split(INDEX_START).length - 1
  const ends = markdown.split(INDEX_END).length - 1
  if (starts !== 1 || ends !== 1) {
    throw new Error(`docs/ARCHITECTURE.md needs exactly one ${INDEX_START} and one ${INDEX_END} (found ${starts} and ${ends}); ${INDEX_HINT}`)
  }
  const from = markdown.indexOf(INDEX_START) + INDEX_START.length
  const to = markdown.indexOf(INDEX_END)
  if (to < from) throw new Error(`${INDEX_END} comes before ${INDEX_START}; ${INDEX_HINT}`)
  return markdown.slice(from, to)
}

/** Every "- `METHOD /path`: consumers" line of the block, in order. Other lines (headings, notes) are ignored. */
function indexLines(block: string): IndexLine[] {
  const lines: IndexLine[] = []
  for (const line of block.split(/\r?\n/)) {
    const match = /^- `([A-Z]+) (\/[^`\s]*)`:\s*(.*)$/.exec(line)
    if (match) lines.push({ method: match[1] ?? '', path: match[2] ?? '', consumers: (match[3] ?? '').trim() })
  }
  return lines
}

/** What is wrong with an index, as readable problems; an empty list means it matches the contract path for path. */
function indexProblems(lines: readonly IndexLine[], contractPaths: readonly string[]): string[] {
  const problems: string[] = []
  const listed = lines.map((l) => l.path)
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const p of listed) (seen.has(p) ? repeated : seen).add(p)
  const missing = contractPaths.filter((p) => !seen.has(p))
  const extra = [...seen].filter((p) => !contractPaths.includes(p))
  const notGet = lines.filter((l) => l.method !== 'GET').map((l) => `${l.method} ${l.path}`)
  const bare = lines.filter((l) => l.consumers === '').map((l) => l.path)
  if (missing.length > 0) problems.push(`missing from the endpoint index: ${missing.join(', ')}`)
  if (extra.length > 0) problems.push(`in the endpoint index but not in contract/openapi.json: ${extra.join(', ')}`)
  if (repeated.size > 0) problems.push(`listed more than once: ${[...repeated].join(', ')}`)
  if (notGet.length > 0) problems.push(`not a GET line: ${notGet.join(', ')}`)
  if (bare.length > 0) problems.push(`no consumer text (write "no screen yet" when none): ${bare.join(', ')}`)
  return problems.length === 0 ? [] : [...problems, `Fix: ${INDEX_HINT}`]
}

const CONTRACT_INDEX: IndexLine[] = CONTRACT_PATHS.map((p) => ({ method: 'GET', path: p, consumers: 'HOME' }))

describe('the endpoint index checker (born failing on a planted drift)', () => {
  it('accepts an index that lists every contract path once', () => {
    expect(indexProblems(CONTRACT_INDEX, CONTRACT_PATHS)).toEqual([])
  })

  it('reports the one path a planted index leaves out, with the hint', () => {
    const dropped = CONTRACT_PATHS[7] ?? ''
    const planted = CONTRACT_INDEX.filter((l) => l.path !== dropped)
    expect(planted).toHaveLength(CONTRACT_PATHS.length - 1)
    const problems = indexProblems(planted, CONTRACT_PATHS)
    expect(problems.join('\n')).toContain(`missing from the endpoint index: ${dropped}`)
    expect(problems.join('\n')).toContain(INDEX_HINT)
  })

  it('reports a path the contract does not have, a repeat, a non-GET line and an empty consumer', () => {
    const planted: IndexLine[] = [
      ...CONTRACT_INDEX,
      { method: 'GET', path: '/api/not-a-route', consumers: 'HOME' },
      { method: 'GET', path: CONTRACT_PATHS[0] ?? '', consumers: 'HOME' },
      { method: 'POST', path: '/api/jobs', consumers: 'none' },
      { method: 'GET', path: '/api/empty', consumers: '' },
    ]
    const text = indexProblems(planted, CONTRACT_PATHS).join('\n')
    expect(text).toContain('/api/not-a-route')
    expect(text).toContain(`listed more than once: ${CONTRACT_PATHS[0]}`)
    expect(text).toContain('POST /api/jobs')
    expect(text).toContain('no consumer text')
  })

  it('reads only the lines between the markers, and refuses a missing or doubled marker', () => {
    const block = indexBlock(`x\n${INDEX_START}\n- \`GET /api/a\`: HOME\nnot a line\n- \`GET /api/b\`: no screen yet\n${INDEX_END}\n- \`GET /api/c\`: after`)
    expect(indexLines(block).map((l) => l.path)).toEqual(['/api/a', '/api/b'])
    expect(() => indexBlock('no markers here')).toThrow(INDEX_HINT)
    expect(() => indexBlock(`${INDEX_START}\n${INDEX_START}\n${INDEX_END}`)).toThrow(INDEX_HINT)
    expect(() => indexBlock(`${INDEX_END}\n${INDEX_START}`)).toThrow(INDEX_HINT)
  })
})

describe('docs/ARCHITECTURE.md section 4.1 endpoint index', () => {
  it('pins the contract to the 81 paths the docs quote, all GET but the three writes', () => {
    expect(CONTRACT_PATHS, 'contract/openapi.json changed: update docs/ARCHITECTURE.md section 4.1 and the README path count').toHaveLength(81)
    // PRD U3 and 03 10.3: the queue's POST and DELETE and the workspace PUT are the only writes; every other path is GET and nothing else.
    const writes: Readonly<Record<string, readonly string[]>> = { '/api/jobs': ['get', 'post'], '/api/jobs/{job_id}': ['get', 'delete'], '/api/workspaces/{doc}': ['get', 'put'] }
    for (const [route, methods] of Object.entries(OPENAPI.paths)) expect({ route, methods: Object.keys(methods).sort() }).toEqual({ route, methods: [...(writes[route] ?? ['get'])].sort() })
  })

  it('lists exactly the paths of contract/openapi.json, once each, as GET lines with a consumer', () => {
    const lines = indexLines(indexBlock(ARCHITECTURE))
    expect(indexProblems(lines, CONTRACT_PATHS)).toEqual([])
    expect(lines).toHaveLength(CONTRACT_PATHS.length)
  })

  it('has its own heading, above the block, and says the consumers are best effort', () => {
    const before = ARCHITECTURE.slice(0, ARCHITECTURE.indexOf(INDEX_START))
    expect(/^### 4\.1 Endpoint index$/m.test(before), 'ARCHITECTURE.md has the heading "### 4.1 Endpoint index" above the markers').toBe(true)
    expect(/best effort/i.test(before.slice(before.lastIndexOf('### 4.1'))), 'section 4.1 says its consumers are best effort').toBe(true)
  })

  it('agrees with every "N paths" the README and ARCHITECTURE state', () => {
    const counts = [...`${README}\n${ARCHITECTURE}`.matchAll(/\b(\d+) (?:API |contract )?paths\b/g)].map((m) => Number(m[1]))
    expect(counts.length).toBeGreaterThan(0)
    for (const count of counts) expect(count).toBe(CONTRACT_PATHS.length)
  })
})

const PNPM_BUILTINS = new Set(['install', 'exec'])

/**
 * The word after `pnpm` in every command shape the docs use; a number (`pnpm 11`) or a flag is not a command. The name
 * may hold digits after its first letter (`e2e:offline`): a class of `[a-z:-]` alone would cut it to `e`.
 */
function pnpmCommands(markdown: string): string[] {
  const names: string[] = []
  for (const match of markdown.matchAll(/pnpm --dir (?:terminal\\web|web) ([a-z][a-z0-9:-]*)/g)) names.push(match[1] ?? '')
  for (const match of markdown.matchAll(/corepack pnpm (?!--)([a-z][a-z0-9:-]*)/g)) names.push(match[1] ?? '')
  // The bare form (`pnpm gen:api`): the backtick must directly precede pnpm, so `corepack pnpm ...` is not counted twice,
  // `pnpm 11` and `pnpm --dir` are excluded, and the word "pnpm" in a sentence does not match.
  for (const match of markdown.matchAll(/`pnpm ([a-z][a-z0-9:-]*)/g)) names.push(match[1] ?? '')
  return names
}

describe('pnpm commands in the docs', () => {
  const scripts = Object.keys(PACKAGE.scripts)

  it('finds the commands it is meant to check (planted text)', () => {
    const planted = 'run `pnpm --dir terminal\\web test:types`, `pnpm --dir web e2e:offline`, `corepack pnpm demo` and `corepack pnpm --dir web exec playwright test`; pnpm 11 through corepack'
      + ' then `pnpm gen:api`, `pnpm install --frozen-lockfile`, `pnpm e2e:perf` and the `pnpm` command'
    // Sorted, so the order in which the three patterns match does not matter.
    expect(pnpmCommands(planted).sort()).toEqual(['demo', 'e2e:offline', 'e2e:perf', 'exec', 'gen:api', 'install', 'test:types'])
  })

  it('names a package.json script in every README command, install and exec aside', () => {
    const names = pnpmCommands(README)
    expect(names.length).toBeGreaterThan(8)
    const unknown = names.filter((n) => !PNPM_BUILTINS.has(n) && !scripts.includes(n))
    expect(unknown).toEqual([])
  })

  it('names a package.json script in every ARCHITECTURE command, install and exec aside', () => {
    const unknown = pnpmCommands(ARCHITECTURE).filter((n) => !PNPM_BUILTINS.has(n) && !scripts.includes(n))
    expect(unknown).toEqual([])
  })

  it('documents the three offline E2E scripts, and all three exist', () => {
    for (const name of ['e2e:offline', 'e2e:offline:perf', 'e2e:offline:baseline']) {
      expect(scripts, `package.json scripts hold ${name}`).toContain(name)
      mentions(README, 'README', name)
    }
  })
})

describe('README', () => {
  it('shows the macOS and Linux launcher and the offline E2E, and no longer says features "come in P1"', () => {
    mentions(README, 'README', './start.sh doctor')
    mentions(README, 'README', 'e2e:offline')
    expect(README.includes('come in P1'), 'README still says features "come in P1"').toBe(false)
  })

  it('mentions engineStrict only when web/pnpm-workspace.yaml sets it', () => {
    const workspace = readFileSync(path.join(WEB, 'pnpm-workspace.yaml'), 'utf8')
    if (README.includes('engineStrict')) expect(workspace).toContain('engineStrict')
  })

  it('links only to files and folders that exist', () => {
    const missing: string[] = []
    for (const match of README.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = decodeURIComponent(match[1] ?? '')
      if (!existsSync(path.join(ROOT, target))) missing.push(target)
    }
    for (const match of README.matchAll(/(?:src|href)="(?!https?:|#)([^"]+)"/g)) {
      if (!existsSync(path.join(ROOT, match[1] ?? ''))) missing.push(match[1] ?? '')
    }
    expect(missing).toEqual([])
  })

  it('names only spec and source files that exist (under web/, or at the repository root for scripts/start.mjs)', () => {
    const missing: string[] = []
    for (const document of [README, TESTING]) {
      for (const match of document.matchAll(/`((?:e2e|src|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|mjs))`/g)) {
        const file = match[1] ?? ''
        if (!existsSync(path.join(WEB, file)) && !existsSync(path.join(ROOT, file))) missing.push(file)
      }
    }
    expect(missing).toEqual([])
  })

  it('lists the command words and the go link rule', () => {
    for (const word of ['RESET', 'UNDO', 'WATCH', 'GRAB', 'SAVE', 'LOAD', 'FORGET']) mentions(README, 'README', `\`${word}`)
    expect(/links open screens, contexts and help only/i.test(README), 'README states the go link rule').toBe(true)
  })

  it('quotes only versions that web/package.json pins', () => {
    const pinned: ReadonlyArray<readonly [string, string]> = [
      ['React', PACKAGE.dependencies.react ?? ''],
      ['TypeScript', PACKAGE.devDependencies.typescript ?? ''],
      ['Vite', PACKAGE.devDependencies.vite ?? ''],
      ['pnpm', PACKAGE.packageManager.replace(/^pnpm@/, '')],
    ]
    let checked = 0
    for (const [name, version] of pinned) {
      for (const match of README.matchAll(new RegExp(`\\b${name} (\\d+\\.\\d+\\.\\d+)`, 'g'))) {
        expect(match[1], `README says ${match[0]}`).toBe(version)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4)
  })

  it('gives the metric count and priorities the catalogue holds', () => {
    const rows = [...CATALOG.matchAll(/^\| [A-Z]{2,3}\d+[a-z]? \| (P[0-2]) \|/gm)].map((m) => m[1])
    const by = (p: string): number => rows.filter((r) => r === p).length
    mentions(README, 'README', `lists ${rows.length} metrics (${by('P0')} P0, ${by('P1')} P1, ${by('P2')} P2)`)
  })

  it('lists the mnemonics of the registry, in its order and with its priorities, and counts them right', () => {
    const registry = readFileSync(path.join(WEB, 'src', 'commands', 'registry.ts'), 'utf8')
    const defined = [...registry.matchAll(/^\s*def\('([A-Z0-9]+)', '(P[0-2])'/gm)].map((m) => `${m[1]} ${m[2]}`)
    const listed = [...README.matchAll(/^\| \d+ \| `([A-Z0-9]+)` \|.*\| (P[0-2])(?:,[^|]*)? \|$/gm)].map((m) => `${m[1]} ${m[2]}`)
    expect(defined.length).toBeGreaterThan(20)
    expect(listed).toEqual(defined)
    for (const match of README.matchAll(/\b(\d+) mnemonics\b/g)) expect(Number(match[1]), match[0]).toBe(defined.length)
    const screens = readFileSync(path.join(WEB, 'src', 'chrome', 'WorkspaceScreens.tsx'), 'utf8')
    const block = screens.slice(screens.indexOf('export const BUILT_SCREENS'))
    const built = [...block.slice(0, block.indexOf('\n}\n')).matchAll(/^\s+([A-Z0-9]+): /gm)].length
    mentions(README, 'README', `${built} of the ${defined.length} mnemonics open a screen`)
  })

  it('carries no em or en dash', () => {
    expect(/[\u2013\u2014]/.test(README), 'README.md holds an em or en dash').toBe(false)
  })
})

describe('docs/TESTING.md', () => {
  it('lists the skips of the offline run by their reason, and the ports and scripts it uses', () => {
    mentions(TESTING, 'TESTING.md', 'not in the demo dataset')
    for (const item of ['e2e:offline', 'e2e:offline:perf', 'e2e:offline:baseline', 'NQT_E2E_OFFLINE_PORT', 'NQT_E2E_DEMO_PORT', 'offline-']) {
      mentions(TESTING, 'TESTING.md', item)
    }
  })

  it('names the specs of the offline project, and each spec file exists', () => {
    const named = [...new Set([...TESTING.matchAll(/`(e2e\/[A-Za-z0-9_./-]+\.spec\.ts)`/g)].map((m) => m[1] ?? ''))]
    // The three specs that hold an offline skip: the keyboard flows, the performance budgets and the rules flows (the fence step).
    for (const spec of ['e2e/flows/keyboard.spec.ts', 'e2e/perf/budgets.spec.ts', 'e2e/flows/rules.spec.ts']) expect(named, spec).toContain(spec)
    expect(named.filter((f) => !existsSync(path.join(WEB, f)))).toEqual([])
  })

  it('carries no em or en dash', () => {
    expect(/[\u2013\u2014]/.test(TESTING), 'TESTING.md holds an em or en dash').toBe(false)
  })
})

/** The status line of ARCHITECTURE.md: which sections were refreshed, on any ISO date. */
const STATUS_LINE = /Sections 1, 2, 4\.1 and 11 refreshed on \d{4}-\d\d-\d\d to match the code\./

describe('docs/ARCHITECTURE.md section 1', () => {
  const section1 = (() => {
    const from = ARCHITECTURE.indexOf('## 1. Stack')
    const to = ARCHITECTURE.indexOf('## 2. Folder layout')
    return from >= 0 && to > from ? ARCHITECTURE.slice(from, to) : ''
  })()
  const version = (name: string): string => PACKAGE.dependencies[name] ?? PACKAGE.devDependencies[name] ?? ''

  it('is found', () => {
    expect(section1.length).toBeGreaterThan(500)
  })

  it('quotes the version web/package.json pins, next to each library name', () => {
    const rows: ReadonlyArray<readonly [string, string]> = [
      ['dockview-react', version('dockview-react')],
      ['lightweight-charts', version('lightweight-charts')],
      ['uPlot', version('uplot')],
      ['ECharts', version('echarts')],
      ['cmdk', version('cmdk')],
      ['zustand', version('zustand')],
      ['@tanstack/react-query', version('@tanstack/react-query')],
      ['@tanstack/react-table', version('@tanstack/react-table')],
      ['@tanstack/react-virtual', version('@tanstack/react-virtual')],
      ['Perspective', version('@perspective-dev/client')],
      ['Tailwind', version('tailwindcss')],
      ['Vite', version('vite')],
      ['React', version('react')],
      ['TypeScript', version('typescript')],
      ['pnpm', PACKAGE.packageManager.replace(/^pnpm@/, '')],
      ['openapi-typescript', version('openapi-typescript')],
      ['vitest', version('vitest')],
      ['@playwright/test', version('@playwright/test')],
      ['@axe-core/playwright', version('@axe-core/playwright')],
      ['Source Sans 3', version('@fontsource/source-sans-3')],
      ['PT Mono', version('@fontsource/pt-mono')],
    ]
    const wrong = rows.filter(([name, v]) => v === '' || !section1.includes(`${name} ${v}`)).map(([name, v]) => `${name} ${v}`)
    expect(wrong).toEqual([])
  })

  it('pins the four Perspective packages to one version, and Tailwind to the plugin and the compiler alike', () => {
    const perspective = ['client', 'server', 'viewer', 'viewer-datagrid'].map((p) => version(`@perspective-dev/${p}`))
    expect(new Set(perspective).size).toBe(1)
    expect(version('@tailwindcss/vite')).toBe(version('tailwindcss'))
  })

  it('names Bergoom and no font or library the terminal dropped', () => {
    mentions(section1, 'section 1', 'Bergoom')
    mentions(section1, 'section 1', 'CommandLine.keys.ts')
    for (const dropped of [/tinykeys/i, /JetBrains/i, /Space Grotesk/i, /\bInter\b/]) {
      expect(dropped.test(`${section1}\n${README}`), `section 1 or the README still names ${dropped}`).toBe(false)
    }
  })

  it('has the status line that says which sections were refreshed, whichever day it was last refreshed', () => {
    expect(STATUS_LINE.test('Sections 1, 2, 4.1 and 11 refreshed on 2027-01-05 to match the code.')).toBe(true)
    expect(STATUS_LINE.test('Sections 1, 2 and 11 refreshed on 2027-01-05 to match the code.')).toBe(false)
    expect(STATUS_LINE.test(ARCHITECTURE), 'the status line names the refreshed sections').toBe(true)
  })

  it('carries no em or en dash', () => {
    expect(/[\u2013\u2014]/.test(ARCHITECTURE), 'ARCHITECTURE.md holds an em or en dash').toBe(false)
  })
})

describe('docs/ARCHITECTURE.md section 2 and 11', () => {
  it('names the folders and files the tree has, and each exists', () => {
    // [path that must exist, the text section 2 must show for it]
    const named: ReadonlyArray<readonly [string, string]> = [
      ['web/src/demo', 'demo/'],
      ['web/src/gallery', 'gallery/'],
      ['web/src/perspective', 'perspective/'],
      ['web/src/export', 'export/'],
      ['web/src/quant', 'quant/'],
      ['web/scripts', 'scripts/'],
      ['web/scripts/start', 'start/'],
      ['web/e2e/offline', 'e2e/offline/'],
      ['web/playwright.offline.config.ts', 'playwright.offline.config.ts'],
      ['qa/golden', 'golden/'],
      ['start.sh', 'start.sh'],
      ['scripts/start.mjs', 'scripts/start.mjs'],
      ['web/src/api/queries.ts', 'api/queries.ts'],
      ['web/src/api/client.ts', 'api/client.ts'],
    ]
    const section2 = ARCHITECTURE.slice(ARCHITECTURE.indexOf('## 2. Folder layout'), ARCHITECTURE.indexOf('## 3. Data contracts'))
    for (const [file, shown] of named) {
      expect(existsSync(path.join(ROOT, file)), `${file} exists`).toBe(true)
      mentions(section2, 'section 2', shown)
    }
  })

  it('has a macOS and Linux paragraph in section 11 that names the launcher and the offline suite', () => {
    const section11 = ARCHITECTURE.slice(ARCHITECTURE.indexOf('## 11. Run and test commands'))
    mentions(section11, 'section 11', 'macOS and Linux')
    mentions(section11, 'section 11', './start.sh')
    mentions(section11, 'section 11', 'e2e:offline')
  })
})

describe('docs/UI_SPEC.md', () => {
  it('points at the layouts table where it lives, and at the font the DES wireframe uses', () => {
    mentions(UI_SPEC, 'UI_SPEC', 'web/src/screens/layouts/layouts.ts')
    mentions(UI_SPEC, 'UI_SPEC', 're-exported by chrome/WorkspaceLayouts.ts')
    expect(UI_SPEC.includes('`web/src/chrome/WorkspaceLayouts.ts`'), 'UI_SPEC still names the old layouts file').toBe(false)
    mentions(UI_SPEC, 'UI_SPEC', 'Source Sans 3 13px')
    expect(/\bInter\b/.test(UI_SPEC), 'UI_SPEC still names Inter').toBe(false)
  })

  it('names files that exist', () => {
    expect(existsSync(path.join(WEB, 'src', 'screens', 'layouts', 'layouts.ts'))).toBe(true)
    expect(existsSync(path.join(WEB, 'src', 'chrome', 'WorkspaceLayouts.ts'))).toBe(true)
  })
})

/** The media files the folder README must document: every entry but the README itself (and, here, a Finder .DS_Store or any dotfile). */
function mediaFiles(names: readonly string[]): string[] {
  return names.filter((f) => f !== 'README.md' && !f.startsWith('.'))
}

describe('docs/media', () => {
  const MEDIA = path.join(ROOT, 'docs', 'media')
  const files = mediaFiles(readdirSync(MEDIA))

  it('leaves out the folder README and hidden files a Finder or an editor leaves behind', () => {
    expect(mediaFiles(['a.webp', '.DS_Store', 'README.md'])).toEqual(['a.webp'])
  })

  it('documents every file in the folder, and every file the README shows is in it', () => {
    const undocumented = files.filter((f) => !MEDIA_README.includes(`\`${f}\``))
    expect(undocumented).toEqual([])
    const shown = [...README.matchAll(/docs\/media\/([A-Za-z0-9_.-]+\.(?:webp|gif|svg|png))/g)].map((m) => m[1] ?? '')
    expect(shown.length).toBeGreaterThan(10)
    expect(shown.filter((f) => !files.includes(f))).toEqual([])
  })

  it('shows every screenshot on the page, so none is left behind', () => {
    const unused = files.filter((f) => f.endsWith('.webp') && !README.includes(`docs/media/${f}`))
    expect(unused).toEqual([])
  })

  it('stays small: each WebP under 165 kB, the folder under 6 MB', () => {
    const size = (f: string): number => statSync(path.join(MEDIA, f)).size
    expect(files.filter((f) => f.endsWith('.webp') && size(f) > 165_000)).toEqual([])
    expect(files.reduce((sum, f) => sum + size(f), 0)).toBeLessThan(6_000_000)
  })
})
