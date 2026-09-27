// UI_SPEC section 10: "All strings live in web/src/copy/*.ts so the house style lint can check them as
// one file set." This guard reads every screen and chrome source (tests, galleries and fixtures left
// out) and fails on a prose string literal or JSX text there, and on a copy module kept outside
// src/copy. Uppercase-only strings (mnemonics, tags, key names) are data, not prose, and pass.
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The glob takes literals only, so the left-out patterns are written in place.
const SOURCES = import.meta.glob(
  [
    '/src/screens/**/*.{ts,tsx}',
    '/src/chrome/**/*.{ts,tsx}',
    '!/src/**/*.test.{ts,tsx}',
    '!/src/**/*.gallery.{ts,tsx}',
    '!/src/**/*Gallery.tsx',
    '!/src/**/gallery*.{ts,tsx}',
    '!/src/**/*{fixtures,Fixtures,TestData,testUtil,testHarness,testUniverse,testing}*.{ts,tsx}',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

/** Developer checks over the static layout table: returned to a test, never rendered. */
const DEVELOPER_FILES = new Set(['/src/screens/layouts/validate.ts'])
/** Maintainer notes on screen metadata (the reference function a screen follows); never rendered. */
const NOTE_KEYS = new Set(['follows', 'model', 'context'])
/** Attributes whose values are code, not copy. */
const CODE_ATTRIBUTES = new Set(['className', 'key', 'id', 'role', 'type', 'htmlFor', 'style', 'name', 'href', 'rel', 'target'])

const PROSE = /[A-Za-z]{2,}[,.:;]? +[A-Za-z]{2,}/
/** A class list: lowercase tokens, the first one hyphenated (`mon-flag mon-flag-stale`). */
const CLASS_LIST = /^\s*[a-z0-9]+(?:-[a-z0-9]*)+(?:\s+[a-z0-9]+(?:-[a-z0-9]*)*)*\s*$/
const SELECTOR_LIST = /^[a-z]+(?:,\s*[a-z]+)+$|^\[/
const MIME = /^[a-z]+\/[a-z.+-]+;\s*charset=/

interface Finding {
  readonly file: string
  readonly line: number
  readonly text: string
}

function isCode(text: string): boolean {
  if (!/[a-z]/.test(text)) return true
  return CLASS_LIST.test(text) || SELECTOR_LIST.test(text) || MIME.test(text)
}

function exempt(node: ts.Node): boolean {
  const p = node.parent
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return true
  if (ts.isPropertyAssignment(p) && p.initializer === node && NOTE_KEYS.has(p.name.getText())) return true
  const attribute = ts.isJsxExpression(p) ? p.parent : p
  if (ts.isJsxAttribute(attribute)) {
    const name = attribute.name.getText()
    if (CODE_ATTRIBUTES.has(name) || name.startsWith('data-')) return true
  }
  const call = ts.isTemplateSpan(p) ? p.parent.parent : p
  return ts.isNewExpression(call) && call.expression.getText() === 'Error'
}

function literalParts(node: ts.Node): string[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]
  if (ts.isJsxText(node)) return [node.text.trim()]
  return null
}

/** Prose literals in one source file. */
function proseLiterals(file: string, text: string): Finding[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const found: Finding[] = []
  const visit = (node: ts.Node): void => {
    const parts = literalParts(node)
    const prose = parts?.filter((part) => PROSE.test(part) && !isCode(part)) ?? []
    if (prose.length > 0 && !exempt(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      found.push({ file, line, text: prose.join(' ... ') })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('user-facing strings live in src/copy (UI_SPEC section 10)', () => {
  it('reads the screen and chrome sources', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100)
  })

  it('keeps no copy module beside a screen or in the chrome', () => {
    expect(Object.keys(SOURCES).filter((file) => /\/copy\.tsx?$/.test(file))).toEqual([])
  })

  it('has no prose string literal or JSX text in a screen or chrome source', () => {
    const found = Object.entries(SOURCES)
      .filter(([file]) => !DEVELOPER_FILES.has(file))
      .flatMap(([file, text]) => proseLiterals(file, text))
      .map((f) => `${f.file}:${f.line} ${f.text}`)
    expect(found).toEqual([])
  })
})

describe('born-failing cases (rule 5): the guard catches what it bans', () => {
  it('flags JSX text, a prose attribute and a prose template', () => {
    const planted = [
      'export const A = () => <p aria-label="Close the panel">Loading the chart.</p>',
      'export const b = (n: number) => `${n} rows shown`',
      "export const c = { label: 'Filter runs' }",
    ].join('\n')
    expect(proseLiterals('/src/screens/x/Planted.tsx', planted).map((f) => f.line)).toEqual([1, 1, 2, 3])
  })

  it('passes code strings, uppercase data, developer errors and maintainer notes', () => {
    const fine = [
      'export const A = () => <div className="mon-flag mon-flag-stale" data-kind="two words">GO</div>',
      "export const b = el.closest('input, textarea, select')",
      "export const c = new Blob([], { type: 'text/csv;charset=utf-8' })",
      "export const d = () => { throw new Error('order is not a permutation') }",
      "export const e = { code: 'RUNS', follows: 'strategy table with numbered rows', tag: '[POST HOC]' }",
      "import { x } from '../../copy/runs'",
    ].join('\n')
    expect(proseLiterals('/src/screens/x/Fine.tsx', fine)).toEqual([])
  })
})
