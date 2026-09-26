// Source scan over the whole front end (ARCHITECTURE section 9, TASKS 4.4): no raw-HTML injection
// prop, and no file, route or component name that reads as a trading action.
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '/e2e/**/*.ts', '/*.config.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Built by concatenation so this file does not contain the banned word itself.
const RAW_HTML_PROP = ['dangerously', 'Set', 'Inner', 'HTML'].join('')
const ACTION_WORD = /^(order|orders|submit|cancel|modify)$/i
const THIS_FILE = '/src/chrome/Workspace.safety.test.ts'

/** Component and route-like names declared in a source file. */
function declaredNames(text: string): string[] {
  const names = [
    ...text.matchAll(/\b(?:function|class|const|let)\s+([A-Z][A-Za-z0-9_]*)/g),
    ...text.matchAll(/\bpath\s*:\s*['"`]([^'"`]+)['"`]/g),
  ]
  return names.map((m) => m[1] ?? '')
}

/** Words of an identifier or path: camelCase, PascalCase, snake_case, kebab-case and dots split. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
}

const isActionName = (name: string): boolean => words(name).some((w) => ACTION_WORD.test(w))

// DOM sinks that parse a string as HTML, and markdown set-ups that pass raw HTML through. Content
// shown by the terminal (summaries, sealed markdown) is machine-generated, so none of these may appear
// outside tests (ARCHITECTURE section 9). Patterns are built from parts so this file does not match.
const HTML_SINKS: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(['\\.(inner', '|outer)HTML\\s*='].join('')), 'DOM HTML sink'],
  [new RegExp(['insertAdjacent', 'HTML'].join('')), 'DOM HTML sink'],
  [new RegExp(['document\\.wr', 'ite(ln)?\\s*\\('].join('')), 'document.write'],
  [new RegExp(['\\bsrc', 'doc\\b'].join('')), 'iframe srcdoc'],
  [new RegExp(['createContextual', 'Fragment'].join('')), 'DOM HTML sink'],
  [new RegExp(['rehype', '-raw'].join('')), 'markdown raw HTML'],
  [new RegExp(['\\bhtml\\s*:', '\\s*true\\b'].join('')), 'markdown raw HTML'],
]
const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file)

function sinkProblems(file: string, text: string): string[] {
  if (file === THIS_FILE || isTest(file)) return []
  return HTML_SINKS.filter(([pattern]) => pattern.test(text)).map(([, what]) => `${file}: ${what}`)
}

export function findProblems(files: Readonly<Record<string, string>>): string[] {
  return Object.entries(files).flatMap(([file, text]) => {
    const problems: string[] = [...sinkProblems(file, text)]
    if (file !== THIS_FILE && text.includes(RAW_HTML_PROP)) problems.push(`${file}: raw HTML prop`)
    const base = file.split('/').pop() ?? file
    if (isActionName(base)) problems.push(`${file}: file name`)
    for (const name of declaredNames(text)) {
      if (isActionName(name)) problems.push(`${file}: name ${name}`)
    }
    return problems
  })
}

describe('front-end source safety scan', () => {
  it('scans a real set of files', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20)
    expect(Object.keys(SOURCES)).toContain('/src/App.tsx')
  })

  it('finds no raw HTML prop and no action-like file, component or route name', () => {
    expect(findProblems(SOURCES)).toEqual([])
  })

  it('born failing: catches each banned form on a planted snippet', () => {
    const planted = {
      '/src/screens/OrderTicket.tsx': 'export default function Ticket() { return null }',
      '/src/chrome/Bad.tsx': `export function SubmitButton() { return <div ${RAW_HTML_PROP}={{ __html: x }} /> }`,
      '/src/routes.ts': "export const routes = [{ path: '/cancel-all' }]",
      '/src/theme/borders.ts': 'export const SIGNAL_BORDER = 1; function Reorderable() {}',
    }
    expect(findProblems(planted)).toEqual([
      '/src/screens/OrderTicket.tsx: file name',
      '/src/chrome/Bad.tsx: raw HTML prop',
      '/src/chrome/Bad.tsx: name SubmitButton',
      '/src/routes.ts: name /cancel-all',
    ])
  })

  it.each([
    ['el.inner' + 'HTML = text', 'DOM HTML sink'],
    ['el.outer' + 'HTML = text', 'DOM HTML sink'],
    ['el.insertAdjacent' + 'HTML("beforeend", text)', 'DOM HTML sink'],
    ['document.wr' + 'ite(text)', 'document.write'],
    ['<iframe src' + 'doc={text} />', 'iframe srcdoc'],
    ['range.createContextual' + 'Fragment(text)', 'DOM HTML sink'],
    ["import raw from 'rehype" + "-raw'", 'markdown raw HTML'],
    ['new MarkdownIt({ html' + ': true })', 'markdown raw HTML'],
  ])('born failing: flags %s outside tests', (snippet, what) => {
    expect(findProblems({ '/src/screens/des/Summary.tsx': snippet })).toEqual([`/src/screens/des/Summary.tsx: ${what}`])
    expect(findProblems({ '/src/screens/des/Summary.test.tsx': snippet })).toEqual([])
  })
})
