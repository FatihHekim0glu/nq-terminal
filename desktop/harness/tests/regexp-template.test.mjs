// A RegExp built from an untagged template literal loses a single backslash: in `PYTEST\.${pid}\.lock` the backslash-dot
// is not an escape sequence, so the string holds a plain dot and the pattern matches any character there (0.3.1 audit:
// four assertions in pytest-wait.test.mjs were looser than they read). The right spellings are a doubled backslash
// (`\\.`) or String.raw. This scan fails on any new RegExp call whose template literal holds a single backslash before a
// character that matters to a pattern, in every .mjs file under desktop/harness and desktop/scripts (node_modules
// skipped). Its planted cases prove that it trips.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROOTS = ['harness', 'scripts'].map((name) => path.join(DESKTOP, name))
const BACKSLASH = String.fromCharCode(92)
/** What a lone backslash must not precede in a template that becomes a pattern: punctuation, and the class escapes whose
 * backslash a template drops (d, w, s) or turns into a control character (b). `n`, `t` and `r` are real escapes. */
const FRAGILE = new Set('.*+?^${}()|[]dDwWsSbB'.split(''))
/** Lines that deliberately hold a single backslash, each with its reason. None today. */
const ALLOWED = []

/** The 1-based line of every single backslash before a FRAGILE character in the template literals that a new RegExp call opens. */
export function scanTemplates(source) {
  const found = []
  const opener = /new\s+RegExp\(\s*`/g
  for (let match = opener.exec(source); match !== null; match = opener.exec(source)) {
    let at = match.index + match[0].length
    let depth = 0 // inside ${ ... } the text is code, not template
    for (; at < source.length; at += 1) {
      const ch = source[at]
      if (depth > 0) {
        if (ch === '{') depth += 1
        else if (ch === '}') depth -= 1
        continue
      }
      if (ch === '`') break
      if (ch === '$' && source[at + 1] === '{') { depth = 1; at += 1; continue }
      if (ch !== BACKSLASH) continue
      let run = 0
      while (source[at + run] === BACKSLASH) run += 1
      const next = source[at + run]
      if (run === 1 && FRAGILE.has(next)) found.push(source.slice(0, at).split('\n').length)
      at += run - 1 // the run's last backslash decides the next character; the others pair up
      if (run % 2 === 1) at += 1 // an escaped character is not looked at again
    }
    opener.lastIndex = at
  }
  return found
}

function* mjsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* mjsFiles(full)
    else if (entry.name.endsWith('.mjs')) yield full
  }
}

test('no RegExp is built from a template literal with a single backslash before a pattern character', () => {
  const trouble = []
  for (const root of ROOTS) {
    for (const file of mjsFiles(root)) {
      const rel = path.relative(DESKTOP, file).replaceAll(BACKSLASH, '/')
      for (const line of scanTemplates(fs.readFileSync(file, 'utf8'))) {
        if (!ALLOWED.some((a) => a.file === rel && a.line === line)) trouble.push(`${rel}:${line}`)
      }
    }
  }
  assert.deepEqual(trouble, [], `use a doubled backslash or String.raw: ${trouble.join(', ')}`)
})

// The planted sources are assembled from BACKSLASH, so that what the scan reads is exactly what is meant here.
test('the scan trips on a planted single backslash, a planted class escape and a planted escaped dollar', () => {
  assert.deepEqual(scanTemplates('x\nnew RegExp(`PYTEST' + BACKSLASH + '.${pid}' + BACKSLASH + '.lock`)'), [2, 2])
  assert.deepEqual(scanTemplates('new RegExp(`a' + BACKSLASH + 'd+b`)'), [1])
  assert.deepEqual(scanTemplates('new RegExp(`cost ' + BACKSLASH + '$5`)'), [1])
  assert.deepEqual(scanTemplates('new RegExp( `[' + BACKSLASH + 'w-]`, "i")'), [1])
})

test('the scan passes a doubled backslash, String.raw, a quoted pattern, a literal and an interpolation', () => {
  const two = BACKSLASH + BACKSLASH
  assert.deepEqual(scanTemplates('new RegExp(`PYTEST' + two + '.${pid}' + two + '.lock`)'), [])
  assert.deepEqual(scanTemplates('new RegExp(String.raw`PYTEST' + BACKSLASH + '.${pid}' + BACKSLASH + '.lock`)'), [])
  assert.deepEqual(scanTemplates("new RegExp('PYTEST" + two + ".lock')"), [])
  assert.deepEqual(scanTemplates('const r = /PYTEST' + BACKSLASH + '.lock/; new RegExp(`${name.replace(/' + BACKSLASH + './g, "_")}`)'), [], 'code inside ${} is not template text')
  assert.deepEqual(scanTemplates('new RegExp(`line' + BACKSLASH + 'nbreak' + BACKSLASH + 't`)'), [], 'a newline or tab escape is meant')
  assert.deepEqual(scanTemplates('new RegExp(`a' + two + two + '.b`)'), [], 'an even run is a doubled pair')
})

test('a template that is not a RegExp argument is left alone', () => {
  assert.deepEqual(scanTemplates('const text = `PYTEST' + BACKSLASH + '.lock`; log(`a' + BACKSLASH + '.b`)'), [])
})
