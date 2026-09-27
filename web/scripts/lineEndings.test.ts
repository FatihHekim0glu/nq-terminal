// Every text file of the web app is stored with LF line endings. The repository keeps bytes as they are
// (terminal/.gitattributes: * -text), so an editor or script that writes CRLF shows up as a full-file
// change and hides the real diff. This keeps the web tree on one line ending.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const ROOTS = ['src', 'e2e', 'scripts']
const ROOT_FILES = ['package.json', 'playwright.config.ts', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'index.html']
const TEXT = /\.(ts|tsx|mts|mjs|js|css|json|html|md|sha256)$/
const SKIP = new Set(['node_modules', '__screenshots__', 'dist', 'dist-gallery', 'test-results', '.results', 'playwright-report'])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : TEXT.test(name) ? [path] : []
  })
}

describe('line endings', () => {
  it('stores every web text file with LF only', () => {
    const files = [...ROOTS.flatMap((r) => walk(join(WEB, r))), ...ROOT_FILES.map((f) => join(WEB, f))]
    expect(files.length).toBeGreaterThan(100)
    const crlf = files.filter((f) => readFileSync(f).includes('\r\n')).map((f) => relative(WEB, f))
    expect(crlf).toEqual([])
  })

  it('skips the Playwright output folder that playwright.config.ts names, so a local run cannot fail it', () => {
    const config = readFileSync(join(WEB, 'playwright.config.ts'), 'utf8')
    const outputDir = /outputDir:\s*'([^']+)'/.exec(config)?.[1]
    expect(outputDir).toBeDefined()
    expect(SKIP.has(basename(outputDir ?? ''))).toBe(true)
  })
})
