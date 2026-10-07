// The desktop end-to-end project's judge (web/e2e/desktop/watch.ts) names foreign programs against the same list as the
// harness watch (lib/winwatch.mjs): other programs' windows stay notes, each labelled known or not on the list, and a window
// of the run's app tree still fails. watch.ts has only Node imports, so Node strips its types and loads it here.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { KNOWN_FOREIGN as harnessList } from '../lib/winwatch.mjs'

const WATCH = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'e2e', 'desktop', 'watch.ts')).href
const { assess, judge, KNOWN_FOREIGN, KNOWN_FOREIGN_ENV } = await import(WATCH)

const APP = 77
const link = (pid, name) => ({ pid, name, commandLine: '' })
const win = (over) => ({ event: 'new', pid: 900, process: 'x', class: 'Chrome_WidgetWin_1', title: 'T', rect: [0, 0, 400, 30], drawn: true, ...over })

test('the two watches share one named list of known foreign programs', () => {
  assert.deepEqual([...KNOWN_FOREIGN], harnessList)
})

test('a known foreign window is a note that says so, an unlisted one says it is not on the list, and neither fails the run', () => {
  const logi = win({ pid: 901, process: 'logioptionsplus_agent', chain: [link(901, 'logioptionsplus_agent.exe'), link(1, 'explorer.exe')] })
  const chat = { event: 'foreground', pid: 902, process: 'chatclient', class: 'Chrome_WidgetWin_1', title: 'Chat', chain: [link(902, 'ChatClient.exe'), link(1, 'explorer.exe')] }
  const other = win({ pid: 903, chain: [link(903, 'notepad.exe'), link(1, 'explorer.exe')] })
  const verdict = assess([logi, chat, other], APP)
  assert.deepEqual(verdict.failures, [])
  assert.equal(verdict.notes.length, 3)
  assert.match(verdict.notes[0], /known foreign program: logioptionsplus_agent\.exe/)
  assert.match(verdict.notes[1], /foreign program not on the list: ChatClient\.exe/)
  assert.match(verdict.notes[2], /foreign program not on the list: notepad\.exe/)
  assert.equal(KNOWN_FOREIGN_ENV, 'NQT_KNOWN_FOREIGN')
  const saved = process.env.NQT_KNOWN_FOREIGN
  process.env.NQT_KNOWN_FOREIGN = 'chatclient.exe'
  try {
    assert.match(assess([chat], APP).notes[0], /known foreign program: ChatClient\.exe/, 'this PC adds known names through the environment')
  } finally {
    if (saved === undefined) delete process.env.NQT_KNOWN_FOREIGN
    else process.env.NQT_KNOWN_FOREIGN = saved
  }
})

test("a planted window of the run's app tree still fails beside a known foreign one", () => {
  const logi = win({ pid: 901, chain: [link(901, 'logioptionsplus_agent.exe')] })
  const planted = win({ pid: 4242, chain: [link(4242, 'msedgewebview2.exe'), link(APP, 'nq-lab-terminal.exe')] })
  const failures = judge([logi, planted], APP)
  assert.equal(failures.length, 1)
  assert.match(failures[0], /this run's app tree/)
})

test('a window a system host draws for the run from outside its tree still fails (crash dialog, terminal, console)', () => {
  const planted = [
    win({ pid: 810, chain: [link(810, 'WerFault.exe'), link(800, 'svchost.exe')], class: '#32770' }),
    win({ pid: 830, chain: [link(830, 'WindowsTerminal.exe'), link(820, 'explorer.exe')], class: 'CASCADIA_HOSTING_WINDOW_CLASS' }),
    win({ pid: 850, chain: [link(850, 'conhost.exe')], class: 'ConsoleWindowClass' }),
  ]
  for (const event of planted) {
    assert.equal(judge([event], APP).length, 1, JSON.stringify(event))
    assert.deepEqual(assess([event], APP).notes, [])
  }
  const byClass = win({ pid: 900, class: 'ConsoleWindowClass', chain: [link(900, 'chrome.exe'), link(1, 'explorer.exe')] })
  assert.equal(judge([byClass], APP).length, 1, 'a console class counts whichever process draws it')
  const underHost = win({ pid: 900, chain: [link(900, 'notepad.exe'), link(5, 'conhost.exe')] })
  assert.deepEqual(judge([underHost], APP), [], 'only the owner image is judged')
})

// ---- the owner's own terminal (V032, 0.3.1 audit; owner decision of 3 October 2026). watch.ps1's lines carry no window
// handle, so a host window is told apart by its process id and class: one that a `new` line named during the run is the
// run's own doing; a focus change to any other host window is the owner's own terminal and stays a note.

const wt = [link(830, 'WindowsTerminal.exe'), link(820, 'explorer.exe')]
const wtNew = (over) => win({ pid: 830, process: 'WindowsTerminal', class: 'CASCADIA_HOSTING_WINDOW_CLASS', chain: wt, ...over })
const wtFocus = (over) => ({ event: 'foreground', pid: 830, process: 'WindowsTerminal', class: 'CASCADIA_HOSTING_WINDOW_CLASS', title: 'pwsh', chain: wt, ...over })

test("born failing: a focus change to the owner's own terminal that was open before the run is a note, not a failure", () => {
  const verdict = assess([wtFocus({})], APP)
  assert.deepEqual(verdict.failures, [])
  assert.equal(verdict.notes.length, 1)
  assert.match(verdict.notes[0], /host window present before the run: WindowsTerminal\.exe/)
  assert.deepEqual(judge([wtFocus({})], APP), [])
})

test('a terminal or console window that appears during the run still fails, and so does a focus change to it afterwards', () => {
  assert.equal(judge([wtNew({})], APP).length, 1)
  assert.equal(judge([wtNew({}), wtFocus({})], APP).length, 2)
  assert.deepEqual(assess([wtNew({}), wtFocus({})], APP).notes, [])
  const console_ = win({ pid: 850, class: 'ConsoleWindowClass', chain: [link(850, 'conhost.exe')] })
  const consoleFocus = wtFocus({ pid: 850, class: 'ConsoleWindowClass', chain: [link(850, 'conhost.exe')] })
  assert.equal(judge([console_, consoleFocus], APP).length, 2)
})

test("a focus change to another terminal process or class than the one that appeared is the owner's own window", () => {
  assert.equal(judge([wtNew({}), wtFocus({ pid: 831, chain: [link(831, 'WindowsTerminal.exe')] })], APP).length, 1, 'only the new window fails')
  assert.equal(judge([wtNew({}), wtFocus({ class: 'OtherClass' })], APP).length, 1)
})

test('a focus change to a host window with no process id or class fails closed, and so does one with no traced owner', () => {
  assert.equal(judge([wtFocus({ pid: undefined })], APP).length, 1)
  assert.equal(judge([wtFocus({ class: undefined })], APP).length, 1)
  assert.equal(judge([wtFocus({ chain: [] })], APP).length, 1)
  assert.equal(judge([wtFocus({ chain: undefined })], APP).length, 1)
})

test("a focus change to a host window under the run's own app tree still fails", () => {
  const under = [link(850, 'conhost.exe'), link(APP, 'nq-lab-terminal.exe')]
  assert.equal(judge([wtFocus({ pid: 850, chain: under })], APP).length, 1)
})
