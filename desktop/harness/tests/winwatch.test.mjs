// The window watch's verdict: only this run's app tree fails a run; other programs' windows and focus changes are notes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { summariseWatch } from '../lib/winwatch.mjs'

const APP = 77
const app = { pid: APP, exe: 'nq-lab-terminal.exe' }
const webview = { pid: 4242, exe: 'msedgewebview2.exe' }
const chrome = { pid: 900, exe: 'chrome.exe' }
const explorer = { pid: 1, exe: 'explorer.exe' }
const ready = { type: 'ready' }
const summary = { type: 'summary', ticks: 10 }
const win = (over) => ({ type: 'new_window', pid: 900, exe: 'chrome.exe', cls: 'Chrome_WidgetWin_1', title: '', rect: [0, 0, 400, 30], ...over })
const focus = (over) => ({ type: 'foreground', pid: 900, exe: 'chrome.exe', cls: 'Chrome_WidgetWin_1', title: '', ...over })
const watchOf = (...events) => summariseWatch([ready, ...events, summary], { rootPid: APP })

test("another program's new window and focus change are notes, not failures", () => {
  const w = watchOf(win({ chain: [chrome, explorer] }), focus({ chain: [chrome, explorer] }))
  assert.equal(w.clean, true)
  assert.equal(w.newWindows.length, 0)
  assert.equal(w.foregroundChanges.length, 0)
  assert.equal(w.notes.length, 2)
})

test("a new window or a focus change from this run's app or its WebView2 children fails", () => {
  for (const event of [win({ pid: 4242, chain: [webview, app, explorer] }), win({ pid: APP, chain: [app, explorer] })]) {
    const w = watchOf(event)
    assert.equal(w.clean, false, JSON.stringify(event))
    assert.equal(w.newWindows.length, 1)
    assert.equal(w.notes.length, 0)
  }
  const f = watchOf(focus({ pid: 4242, chain: [webview, app] }))
  assert.equal(f.clean, false)
  assert.equal(f.foregroundChanges.length, 1)
})

test('an event whose owner was not traced fails (fail closed), and so does every event when the run has no app', () => {
  for (const event of [win({}), win({ chain: [] }), focus({ pid: null, exe: null, cls: null, title: null })]) {
    assert.equal(watchOf(event).clean, false, JSON.stringify(event))
  }
  const noApp = summariseWatch([ready, win({ chain: [chrome] }), focus({ chain: [chrome] }), summary])
  assert.equal(noApp.clean, false)
  assert.equal(noApp.newWindows.length + noApp.foregroundChanges.length, 2)
})

test('the expected screen-2 window is allowed, inert windows are ignored, and a watch without a summary is not clean', () => {
  const ownFrame = win({ pid: APP, chain: [app] })
  const w = summariseWatch([ready, ownFrame, { type: 'inert_window', pid: APP, chain: [app] }, summary], { rootPid: APP, allow: (e) => e === ownFrame })
  assert.equal(w.clean, true)
  assert.equal(w.allowed.length, 1)
  assert.equal(w.inertWindows.length, 1)
  assert.equal(summariseWatch([ready], { rootPid: APP }).clean, false)
})

test("foreign notes are labelled against the named list of known foreign programs, which is recorded in the summary", async () => {
  const { KNOWN_FOREIGN, KNOWN_FOREIGN_ENV } = await import('../lib/winwatch.mjs')
  assert.deepEqual(KNOWN_FOREIGN, ['logioptionsplus_agent.exe'])
  assert.equal(KNOWN_FOREIGN_ENV, 'NQT_KNOWN_FOREIGN')
  const logi = { pid: 901, exe: 'Logioptionsplus_Agent.EXE' }
  const chat = { pid: 902, exe: 'ChatClient.exe' }
  const events = () => [
    win({ pid: 901, exe: 'Logioptionsplus_Agent.EXE', chain: [logi, explorer] }),
    win({ pid: 902, exe: 'ChatClient.exe', chain: [chat, explorer] }),
    win({ chain: [chrome, explorer] }),
    focus({ pid: 902, exe: 'ChatClient.exe', chain: [chat, explorer] }),
  ]
  const w = watchOf(...events())
  assert.equal(w.clean, true)
  assert.equal(w.notes.length, 4)
  assert.deepEqual(w.foreignSeen, [
    { exe: 'Logioptionsplus_Agent.EXE', known: true, count: 1 },
    { exe: 'ChatClient.exe', known: false, count: 2 },
    { exe: 'chrome.exe', known: false, count: 1 },
  ])
  const saved = process.env.NQT_KNOWN_FOREIGN
  process.env.NQT_KNOWN_FOREIGN = ' chatclient.exe ; ;other.exe'
  try {
    assert.deepEqual(watchOf(...events()).foreignSeen.map((r) => r.known), [true, true, false], 'this PC adds known names through the environment')
  } finally {
    if (saved === undefined) delete process.env.NQT_KNOWN_FOREIGN
    else process.env.NQT_KNOWN_FOREIGN = saved
  }
})

test('a planted window of the run app tree still fails when a known foreign program is on screen too', () => {
  const logi = { pid: 901, exe: 'logioptionsplus_agent.exe' }
  const w = watchOf(win({ pid: 901, chain: [logi, explorer] }), win({ pid: 4242, chain: [webview, app, explorer] }))
  assert.equal(w.clean, false)
  assert.equal(w.newWindows.length, 1)
  assert.equal(w.foreignSeen.length, 1)
})

test('a window a system host draws for the run from outside its tree still fails (crash dialog, terminal, console, loader box)', () => {
  const svchost = { pid: 800, exe: 'svchost.exe' }
  const terminal = { pid: 830, exe: 'WindowsTerminal.exe' }
  const planted = [
    win({ pid: 810, exe: 'WerFault.exe', cls: '#32770', chain: [{ pid: 810, exe: 'WerFault.exe' }, svchost] }),
    win({ pid: 830, exe: 'WindowsTerminal.exe', cls: 'CASCADIA_HOSTING_WINDOW_CLASS', chain: [terminal, explorer] }),
    win({ pid: 850, exe: 'conhost.exe', cls: 'ConsoleWindowClass', chain: [{ pid: 850, exe: 'conhost.exe' }, explorer] }),
    win({ pid: 860, exe: 'csrss.exe', cls: '#32770', chain: [{ pid: 860, exe: 'CSRSS.EXE' }] }),
    focus({ pid: 830, exe: 'WindowsTerminal.exe', cls: 'CASCADIA_HOSTING_WINDOW_CLASS', chain: [terminal, explorer] }),
  ]
  for (const event of planted) {
    const w = watchOf(event)
    assert.equal(w.clean, false, JSON.stringify(event))
    assert.equal(w.notes.length, 0, JSON.stringify(event))
  }
  const byClass = watchOf(win({ pid: 900, cls: 'ConsoleWindowClass', chain: [chrome, explorer] }))
  assert.equal(byClass.clean, false, 'a console class counts whichever process draws it')
  assert.equal(watchOf(win({ chain: [chrome, { pid: 5, exe: 'conhost.exe' }] })).clean, true, 'only the owner image is judged')
})

// ---- the owner's own terminal (V032, 0.3.1 audit; owner decision of 3 October 2026)
// A host window counts when the run could have caused it: a host window that appeared during the run (a crash dialog, a
// console) fails, and so does a focus change to it. A focus change to a host window that was already open when the watch
// started (the owner alt-tabs to their own Windows Terminal) is another program's doing: a note.

const wt = { pid: 830, exe: 'WindowsTerminal.exe' }
const wtWin = (over) => win({ hwnd: 500, pid: 830, exe: 'WindowsTerminal.exe', cls: 'CASCADIA_HOSTING_WINDOW_CLASS', chain: [wt, explorer], ...over })
const wtFocus = (over) => focus({ to: 500, pid: 830, exe: 'WindowsTerminal.exe', cls: 'CASCADIA_HOSTING_WINDOW_CLASS', chain: [wt, explorer], ...over })

test("born failing: a focus change to the owner's own terminal that was open before the run is a note, not a failure", () => {
  const w = watchOf(wtFocus({}))
  assert.equal(w.clean, true)
  assert.equal(w.foregroundChanges.length, 0)
  assert.equal(w.notes.length, 1)
  assert.equal(w.hostBeforeRun.length, 1, 'the report says the host window was there before the run')
  assert.deepEqual(w.foreignSeen, [{ exe: 'WindowsTerminal.exe', known: false, count: 1 }])
})

test('a console or terminal window that appears during the run still fails, whoever started it', () => {
  const conhost = { pid: 850, exe: 'conhost.exe' }
  for (const event of [wtWin({}), win({ hwnd: 501, pid: 850, exe: 'conhost.exe', cls: 'ConsoleWindowClass', chain: [conhost, explorer] })]) {
    const w = watchOf(event)
    assert.equal(w.clean, false, JSON.stringify(event))
    assert.equal(w.newWindows.length, 1)
    assert.equal(w.notes.length, 0)
  }
})

test('a focus change to a host window that appeared during the run fails too (the crash dialog takes focus)', () => {
  const w = watchOf(wtWin({}), wtFocus({}))
  assert.equal(w.clean, false)
  assert.equal(w.newWindows.length, 1)
  assert.equal(w.foregroundChanges.length, 1)
  assert.equal(w.hostBeforeRun.length, 0)
})

test('a focus change to a host window that appeared during the run fails even when the window itself was an allowed one', () => {
  const frame = wtWin({})
  const w = summariseWatch([ready, frame, wtFocus({}), summary], { rootPid: APP, allow: (e) => e === frame })
  assert.equal(w.foregroundChanges.length, 1)
})

test('a focus change to a host window whose handle is not known fails closed, and so does one with no owner traced', () => {
  assert.equal(watchOf(wtFocus({ to: undefined })).clean, false, 'no handle: it cannot be shown to be older than the run')
  assert.equal(watchOf(wtFocus({ to: null })).clean, false)
  assert.equal(watchOf(wtFocus({ chain: [] })).clean, false)
  assert.equal(watchOf(wtFocus({ chain: undefined })).clean, false)
})

test("a focus change to another handle of the same terminal is judged by its own handle", () => {
  const w = watchOf(wtWin({ hwnd: 500 }), wtFocus({ to: 777 }))
  assert.equal(w.newWindows.length, 1)
  assert.equal(w.foregroundChanges.length, 0, 'window 777 was open before the run')
  assert.equal(w.hostBeforeRun.length, 1)
})

test("a focus change to a host window under the run's own app tree still fails", () => {
  const w = watchOf(wtFocus({ chain: [{ pid: 850, exe: 'conhost.exe' }, app, explorer] }))
  assert.equal(w.foregroundChanges.length, 1)
})
