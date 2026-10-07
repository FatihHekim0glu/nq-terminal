// The three window watches carry the same lists: the system host images, the host window classes, the known foreign
// programs and the name of the environment variable that adds to them (0.3.1 part 2). They are written in three languages
// (hidden_support/scope.rs for the Rust watches, lib/winwatch.mjs for the harness, web/e2e/desktop/watch.ts for the
// desktop end-to-end project), so a list changed in one place and not the others would make the watches disagree about
// whose window it is. Born failing: nothing compared the copies. The drift cases plant a change in one copy's text.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COPIES, LIST_NAMES, extractList, extractString, listsOf, drift } from '../lib/watchlists.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const texts = () => Object.fromEntries(Object.entries(COPIES).map(([copy, rel]) => [copy, read(rel)]))

test('the copies are the Rust scope, the harness watch and the end-to-end watch', () => {
  assert.deepEqual(Object.keys(COPIES).sort(), ['e2e', 'harness', 'rust'])
  for (const rel of Object.values(COPIES)) assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} exists`)
})

test('every list is found in every copy and holds what the watches rely on', () => {
  const lists = listsOf(texts())
  for (const copy of Object.keys(COPIES)) {
    for (const name of LIST_NAMES) assert.ok(lists[copy][name].length > 0, `${copy} has a ${name}`)
    assert.ok(lists[copy].images.includes('werfault.exe') && lists[copy].images.includes('conhost.exe'))
    assert.ok(lists[copy].classes.includes('consolewindowclass'))
    assert.ok(lists[copy].known.includes('logioptionsplus_agent.exe'), 'the image name stays a literal')
    assert.equal(lists[copy].env, 'nqt_known_foreign')
  }
})

test('the three copies agree on every list (compared without case, in any order)', () => {
  assert.deepEqual(drift(listsOf(texts())), [])
})

test('a host image dropped from the Rust copy is drift, and the report names the copy and the list', () => {
  const t = texts()
  t.rust = t.rust.replace('    "dllhost.exe",\n', '').replace('    "dllhost.exe",\r\n', '')
  assert.ok(!t.rust.includes('"dllhost.exe",'), 'the plant removed the image from the Rust text')
  const found = drift(listsOf(t))
  assert.equal(found.length, 2, found.join('; ')) // each of the other two copies differs from the Rust one
  assert.match(found[0], /images/)
  assert.match(found[0], /dllhost\.exe/)
})

test('a window class added to the end-to-end copy is drift', () => {
  const t = texts()
  t.e2e = t.e2e.replace("'cascadia_hosting_window_class']", "'cascadia_hosting_window_class', 'extra_class']")
  assert.ok(t.e2e.includes('extra_class'), 'the plant changed the end-to-end text')
  const found = drift(listsOf(t))
  assert.equal(found.length, 1, found.join('; '))
  assert.match(found[0], /classes: e2e differs from rust/)
  assert.match(found[0], /extra_class/)
})

test('a changed known foreign program in the harness copy is drift, and so is a renamed environment variable', () => {
  const t = texts()
  t.harness = t.harness.replace("['logioptionsplus_agent.exe']", "['logioptionsplus_agent.exe', 'other.exe']")
  assert.match(drift(listsOf(t)).join('; '), /known: harness differs.*other\.exe/)
  const e = texts()
  e.harness = e.harness.replace("'NQT_KNOWN_FOREIGN'", "'NQT_KNOWN_OTHER'")
  assert.match(drift(listsOf(e)).join('; '), /env: harness differs/)
})

test('the extractors read a Rust, a TypeScript and a JavaScript declaration', () => {
  assert.deepEqual(extractList('pub const A: [&str; 2] = [\n    "X.exe",\n    "y.exe",\n];', 'A'), ['x.exe', 'y.exe'])
  assert.deepEqual(extractList("export const A: readonly string[] = ['X.exe', 'y']", 'A'), ['x.exe', 'y'])
  assert.deepEqual(extractList("export const A = ['x']", 'A'), ['x'])
  assert.equal(extractString("export const E = 'Name'", 'E'), 'name')
  assert.equal(extractString('pub const E: &str = "Name";', 'E'), 'name')
  assert.throws(() => extractList('nothing here', 'A'), /A/)
})

test('the Logitech program is called a helper program in prose; only its image name keeps the word agent', () => {
  const prose = [...Object.values(COPIES), 'desktop/src-tauri/tests/watch_scope.rs', 'desktop/harness/README.md']
  for (const rel of prose) {
    assert.doesNotMatch(read(rel), /Options\+ agent/i, `${rel} says "Options+ agent"`)
  }
  assert.match(read('desktop/harness/README.md'), /Logitech Options\+ helper program/)
  assert.match(read('desktop/src-tauri/tests/hidden_support/scope.rs'), /Logitech Options\+ helper program/)
})
