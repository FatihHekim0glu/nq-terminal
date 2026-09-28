// Section 8.3 of the look spec in docs/: no trade name, no proprietary font name, no font file other
// than the three OFL families, no reference image, and no proprietary docking package.
// The searched words are assembled from pieces so this file never matches its own search.
import { describe, expect, it } from 'vitest'
import packageJson from '../../package.json?raw'
import lockfile from '../../pnpm-lock.yaml?raw'

interface DirEntry {
  readonly name: string
  isDirectory(): boolean
  isFile(): boolean
}

interface NodeFs {
  existsSync(path: string): boolean
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[]
  readFileSync(path: string): Uint8Array
}

interface NodePath {
  join(...parts: string[]): string
  relative(from: string, to: string): string
  dirname(path: string): string
}

interface NodeUrl {
  fileURLToPath(url: string | URL): string
}

// The app tsconfig carries browser types only, so the Node built-ins are typed here by hand.
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as NodeFs
const path = builtins.getBuiltinModule('node:path') as NodePath
const url = builtins.getBuiltinModule('node:url') as NodeUrl

const WEB = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..')
const TERMINAL = path.join(WEB, '..')
const NQ_LAB = path.join(TERMINAL, '..')
const REFERENCES = path.join(NQ_LAB, 'design_refs', ['b', 'bg'].join(''))

// Build output, installed packages and test output: generated, never committed.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-gallery', 'dist-demo', '.venv', '__pycache__', '.pytest_cache', '.ruff_cache', '.vite',
  'test-results', 'playwright-report', 'blob-report', '.results', 'coverage', 'htmlcov', '.dumps', '.git',
])
const BINARY = /\.(woff2?|ttf|otf|eot|png|jpe?g|gif|webp|ico|pdf|parquet|zip|gz|pyc)$/i
const FONT = /\.(woff2?|ttf|otf|eot)$/i
const IMAGE = /\.(png|jpe?g|gif|webp)$/i

function walk(dir: string, skip: ReadonlySet<string> = SKIP_DIRS): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return skip.has(entry.name) ? [] : walk(full, skip)
    return entry.isFile() ? [full] : []
  })
}

function textOf(file: string): string {
  return new TextDecoder().decode(fs.readFileSync(file))
}

async function sha256(file: string): Promise<string> {
  const bytes = fs.readFileSync(file)
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const NAME = new RegExp(`${['bloom', 'berg'].join('')}|\\b${['b', 'bg'].join('')}\\b`, 'i')
const FONT_NAMES = new RegExp(['Prop', 'Fixed'].map((w) => `${w} ${'Uni'}code`).join('|'), 'i')

function offenders(files: readonly string[], pattern: RegExp): string[] {
  return files
    .filter((f) => !BINARY.test(f))
    .filter((f) => pattern.test(textOf(f)))
    .map((f) => path.relative(TERMINAL, f))
}

// The five Bergoom files as published at github.com/dchest/bergoom, commit e5553246 (2025-05-31).
// The OFL lets us ship them only under their own name when unmodified, so any byte change fails here.
const BERGOOM_SHA256: Record<string, string> = {
  'Bergoom-Regular.woff2': '748811b72a4e3c12801b82aadc1f0548bd58486add1e1fa160abc186d8579530',
  'Bergoom-Italic.woff2': '77ccede85544611f8f6fd3bf48594e1b453a003dbdf55f06ea1161cab60aee51',
  'Bergoom-Semibold.woff2': '28df55eeeb127961292775c8b812a520ff9397cbef8e917877443fae73487cac',
  'Bergoom-Bold.woff2': 'c132d15a9b8fa2d9c84de7a3063720361eb6c8e8c4685e12ea81281f7a35b833',
  'Bergoom-BoldItalic.woff2': '3a34d9c07f90e0ad5bb936abc02b0f4df973df9446fc9e4a16bbfdfc609bed9f',
}

describe('the pattern builders (born failing on a planted sample)', () => {
  it('catches the trade name, its short form and the two font names', () => {
    expect(NAME.test(`a ${['Bloom', 'berg'].join('')} screen`)).toBe(true)
    expect(NAME.test(`the ${['B', 'BG'].join('')} look`)).toBe(true)
    expect(NAME.test('Bergoom, a berg in the sea')).toBe(false)
    expect(FONT_NAMES.test(`${'Prop'} ${'Uni'}code`)).toBe(true)
  })
})

describe('no trade name in the shipped web files (8.3)', () => {
  it('finds nothing in web/src, web/index.html or web/public', () => {
    const files = [
      ...walk(path.join(WEB, 'src')),
      path.join(WEB, 'index.html'),
      ...walk(path.join(WEB, 'public')),
    ]
    expect(files.length).toBeGreaterThan(20)
    expect(offenders(files, NAME)).toEqual([])
  })

  it('finds neither proprietary font name anywhere in terminal/ outside docs/', () => {
    const files = walk(TERMINAL, new Set([...SKIP_DIRS, 'docs']))
    expect(files.length).toBeGreaterThan(50)
    expect(offenders(files, FONT_NAMES)).toEqual([])
  })
})

describe('font files (8.3)', () => {
  it('ships no font file other than Bergoom under web/', () => {
    const fonts = walk(WEB).filter((f) => FONT.test(f)).map((f) => path.relative(WEB, f).replaceAll('\\', '/'))
    expect(fonts.sort()).toEqual(Object.keys(BERGOOM_SHA256).map((n) => `src/assets/fonts/bergoom/${n}`).sort())
  })

  it('vendors the five Bergoom files unmodified, with the OFL licence beside them', async () => {
    const dir = path.join(WEB, 'src', 'assets', 'fonts', 'bergoom')
    for (const [name, expected] of Object.entries(BERGOOM_SHA256)) {
      expect(await sha256(path.join(dir, name)), name).toBe(expected)
    }
    const licence = textOf(path.join(dir, 'LICENSE.md'))
    expect(licence).toContain('SIL Open Font License, Version 1.1')
    expect(licence).toContain("Reserved Font Name 'Bergoom'")
  })

  it('takes the Source Sans 3 and PT Mono fallbacks from OFL packages only', () => {
    const pkg = JSON.parse(packageJson) as { dependencies: Record<string, string> }
    const fontPackages = Object.keys(pkg.dependencies).filter((n) => n.startsWith('@fontsource/')).sort()
    expect(fontPackages).toEqual(['@fontsource/pt-mono', '@fontsource/source-sans-3'])
  })
})

describe('no reference image and no proprietary package (8.3)', () => {
  it('commits no image from the local reference folder', async () => {
    const refs = walk(REFERENCES, new Set()).filter((f) => IMAGE.test(f))
    if (refs.length === 0) return // the folder is local only; nothing to compare on a clean clone
    const refHashes = new Set(await Promise.all(refs.map(sha256)))
    const ours = walk(TERMINAL).filter((f) => IMAGE.test(f))
    const copies: string[] = []
    for (const f of ours) if (refHashes.has(await sha256(f))) copies.push(path.relative(TERMINAL, f))
    expect(copies).toEqual([])
  })

  it('keeps dockview-enterprise out of package.json and the lockfile', () => {
    const word = ['dockview', 'enterprise'].join('-')
    expect(packageJson).not.toContain(word)
    expect(lockfile).not.toContain(word)
  })
})
