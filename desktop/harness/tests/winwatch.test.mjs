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
