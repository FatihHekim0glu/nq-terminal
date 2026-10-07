// docs/desktop/stage1/measure_stage1.mjs decided whether it was the main module by comparing import.meta.url with
// pathToFileURL(process.argv[1]). Behind the junction C:/Users/<owner>/nq-lab (a link to E:/projects/nq-lab) the two differ,
// so main() never ran and the script exited 0 without measuring anything (0.3.1 audit). The shared check in
// desktop/scripts/main-module.mjs compares real paths and says so on stderr when it cannot tell. This test reads the script
// as text: it must call isMainModule(import.meta.url), import it from the shared module, and no longer compare the two
// URLs itself. The line count that docs/desktop/d5_integration.md quotes is checked too, so it cannot go stale again.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SCRIPT = path.join(ROOT, 'docs', 'desktop', 'stage1', 'measure_stage1.mjs')
const text = fs.readFileSync(SCRIPT, 'utf8')

test('measure_stage1.mjs asks the shared check whether it is the main module', () => {
  assert.match(text, /if \(isMainModule\(import\.meta\.url\)\)/)
})

test('it imports isMainModule from the shared module, by a path that reaches the file', () => {
  const found = /import \{ isMainModule \} from '([^']+)'/.exec(text)
  assert.ok(found, 'no import of isMainModule')
  assert.equal(found[1], '../../../desktop/scripts/main-module.mjs')
  assert.ok(fs.existsSync(path.resolve(path.dirname(SCRIPT), found[1])), 'the imported file exists')
})

test('it no longer compares import.meta.url with a started path by strict equality', () => {
  assert.doesNotMatch(text, /import\.meta\.url\s*===/)
  assert.doesNotMatch(text, /===\s*pathToFileURL\(process\.argv/)
})

test('pathToFileURL stays imported, because the script still uses it elsewhere', () => {
  assert.match(text, /import \{ pathToFileURL \} from 'node:url'/)
  assert.ok(text.split('pathToFileURL').length > 2, 'pathToFileURL is used beyond its import')
})

test('d5_integration.md quotes the script\'s real line count', () => {
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'desktop', 'd5_integration.md'), 'utf8')
  const quoted = /`measure_stage1\.mjs` is (\d+) lines/.exec(doc)
  assert.ok(quoted, 'd5_integration.md quotes a line count for measure_stage1.mjs')
  assert.equal(Number(quoted[1]), lines)
})
