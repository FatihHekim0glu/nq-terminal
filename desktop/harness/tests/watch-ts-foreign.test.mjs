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
    { event: 'foreground', pid: 830, process: 'WindowsTerminal', class: 'CASCADIA_HOSTING_WINDOW_CLASS', title: '', chain: [link(830, 'WindowsTerminal.exe')] },
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
