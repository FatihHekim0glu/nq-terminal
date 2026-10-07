// Two source scans over web/src (roadmap D3.2; 02 C3-1, 03 section 4.5):
//  1. The page has no channel to the shell. The shell injects one read-only object (bridge/detect.ts) and the
//     page never calls a command, so any use of a webview command bridge in web/src fails.
//  2. The shell's own host (tauri.localhost) is named in one file only, bridge/ibSwitch.ts: the two exact addresses
//     of the Options IB snapshot switch, which the shell's navigation check recognises and cancels before it asks the
//     owner natively. Any other mention would be a new way to reach the shell.
//  3. Saving a file and writing the clipboard happen in one place. `URL.createObjectURL` and
//     `navigator.clipboard` (and ClipboardItem, which only the clipboard takes) may appear only inside
//     web/src/bridge/** and chrome/download.ts, so a screen that planted its own anchor or clipboard call
//     would skip the bridge and with it the shell's save dialog.
// Test files, test helpers and type declarations are not scanned: they stand in for the browser.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(WEB, 'src')
const SOURCE = /\.(ts|tsx)$/
const NOT_SCANNED = /\.(test|testUtil)\.(ts|tsx)$|\.d\.ts$/
const SKIP = new Set(['node_modules', '__screenshots__'])

const IPC_USES: readonly (readonly [string, RegExp])[] = [
  ['a Tauri global', /__TAURI/],
  ['a command call (invoke)', /\binvoke\s*\(/],
  ['an ipc object', /\bipc\b/i],
  ['the WebView2 message channel', /\bchrome\s*\.\s*webview\b/],
  ['the WebKit message handlers', /\bwebkit\s*\.\s*messageHandlers\b/],
]

const DIRECT_IO: readonly (readonly [string, RegExp])[] = [
  ['URL.createObjectURL', /\bURL\s*\.\s*createObjectURL\b/],
  ['navigator.clipboard', /\bnavigator\s*\??\.\s*clipboard\b/],
  ['ClipboardItem', /\bClipboardItem\b/],
]

/** The files under web/src that carry code the page ships, as paths like `src/chrome/download.ts`. */
function pageSources(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return pageSources(path)
    return SOURCE.test(name) && !NOT_SCANNED.test(name) ? [path] : []
  })
}

const posix = (path: string): string => relative(WEB, path).split('\\').join('/')

/** Every use of a shell command channel in `text`, as `file: what`. */
function findShellIpc(file: string, text: string): string[] {
  return IPC_USES.filter(([, pattern]) => pattern.test(text)).map(([what]) => `${file}: ${what}`)
}

const SHELL_HOST = /tauri\.localhost/i
const SHELL_HOST_HOME = 'src/bridge/ibSwitch.ts'

/** Every mention of the shell's own host in `text` outside the one file that may name it. */
function findShellHost(file: string, text: string): string[] {
  if (file === SHELL_HOST_HOME) return []
  return SHELL_HOST.test(text) ? [`${file}: the shell host`] : []
}

const BRIDGE_HOMES = (file: string): boolean => file.startsWith('src/bridge/') || file === 'src/chrome/download.ts'

/** Every direct file-save or clipboard use in `text` outside the places that may hold one. */
function findDirectIo(file: string, text: string): string[] {
  if (BRIDGE_HOMES(file)) return []
  return DIRECT_IO.filter(([, pattern]) => pattern.test(text)).map(([what]) => `${file}: ${what}`)
}

const files = pageSources().map((path) => ({ file: posix(path), text: readFileSync(path, 'utf-8') }))

describe('the scans see the page sources', () => {
  it('reads the whole tree, without test files and with the bridge', () => {
    const names = files.map((f) => f.file)
    expect(names.length).toBeGreaterThan(300)
    expect(names).toEqual(expect.arrayContaining(['src/bridge/index.ts', 'src/bridge/browser.ts', 'src/bridge/detect.ts', 'src/chrome/download.ts']))
    expect(names.filter((n) => /\.test\./.test(n))).toEqual([])
  })

  it('finds the object-URL anchor in the bridge, so the scan is not empty where it matters', () => {
    const browser = files.find((f) => f.file === 'src/bridge/browser.ts')
    expect(browser?.text).toMatch(/createObjectURL/)
  })
})

describe('no shell IPC in web/src', () => {
  it('finds none in the tree', () => {
    expect(files.flatMap(({ file, text }) => findShellIpc(file, text))).toEqual([])
  })

  it.each([
    ['window.__TAURI__', 'const t = window.__TAURI__.core'],
    ['an internals global', 'window.__TAURI_INTERNALS__.invoke'],
    ['invoke(', "await invoke('read_file', { path })"],
    ['a spaced invoke call', 'invoke  (cmd)'],
    ['an ipc object', 'window.ipc.postMessage(body)'],
    ['the WebView2 channel', 'window.chrome.webview.postMessage(x)'],
    ['the WebKit handlers', 'window.webkit.messageHandlers.nqt.postMessage(x)'],
  ])('born failing: flags a planted %s', (_label, snippet) => {
    expect(findShellIpc('src/screens/x/Screen.tsx', snippet)).toHaveLength(1)
  })

  it('born failing: flags a plant inside the bridge too, which has no allowance', () => {
    expect(findShellIpc('src/bridge/browser.ts', 'window.__TAURI__')).toHaveLength(1)
  })

  it('does not flag words that only contain the letters, or the injected object the page reads', () => {
    expect(findShellIpc('src/x.ts', 'const principal = recipient.ipcode; const reinvoked = 1; window.__NQT_SHELL__')).toEqual([])
  })
})

describe('the shell host is named only by the IB switch addresses', () => {
  it('finds tauri.localhost in src/bridge/ibSwitch.ts and nowhere else', () => {
    expect(files.flatMap(({ file, text }) => findShellHost(file, text))).toEqual([])
    const home = files.find((f) => f.file === SHELL_HOST_HOME)
    expect(home?.text).toMatch(SHELL_HOST)
  })

  it.each([
    ['a planted address in a screen', 'src/screens/live/LiveScreen.tsx', "location.assign('http://tauri.localhost/ib-snapshot/on')"],
    ['a planted address in the frame, in capitals', 'src/chrome/FrameStrip.tsx', "const URI = 'http://TAURI.LOCALHOST/x'"],
    ['a planted address elsewhere in the bridge', 'src/bridge/browser.ts', "window.location.href = 'http://tauri.localhost/'"],
    ['a look-alike file', 'src/bridge/ibSwitch2.ts', "'http://tauri.localhost/ib-snapshot/off'"],
  ])('born failing: flags %s', (_label, file, snippet) => {
    expect(findShellHost(file, snippet)).toHaveLength(1)
  })

  it('the IB switch file names no shell command channel', () => {
    const home = files.find((f) => f.file === SHELL_HOST_HOME)
    expect(home).toBeDefined()
    expect(findShellIpc(SHELL_HOST_HOME, home?.text ?? '')).toEqual([])
  })
})

describe('files are saved and the clipboard is written only through the bridge', () => {
  it('finds no object URL, clipboard call or ClipboardItem outside web/src/bridge and chrome/download.ts', () => {
    expect(files.flatMap(({ file, text }) => findDirectIo(file, text))).toEqual([])
  })

  it('flags the clipboard read of a file outside the bridge homes', () => {
    expect(findDirectIo('src/chrome/copyLink2.ts', 'navigator.clipboard')).toHaveLength(1)
  })

  it.each([
    ['a planted anchor in a screen', 'const url = URL.createObjectURL(blob); link.href = url; link.click()'],
    ['a planted clipboard write', 'await navigator.clipboard.writeText(text)'],
    ['an optional clipboard read', 'const c = navigator?.clipboard'],
    ['an image item', 'new ClipboardItem({ "image/png": blob })'],
    ['a feature check', "typeof ClipboardItem !== 'undefined'"],
  ])('born failing: flags %s', (_label, snippet) => {
    expect(findDirectIo('src/screens/oos/OosScreen.tsx', snippet)).toHaveLength(1)
  })

  it('born failing: the allowance is the bridge folder and download.ts, not a file that merely resembles them', () => {
    const plant = 'URL.createObjectURL(blob)'
    expect(findDirectIo('src/bridge/browser.ts', plant)).toEqual([])
    expect(findDirectIo('src/chrome/download.ts', plant)).toEqual([])
    expect(findDirectIo('src/chrome/download2.ts', plant)).toHaveLength(1)
    expect(findDirectIo('src/chrome/exportCsv.ts', plant)).toHaveLength(1)
    expect(findDirectIo('src/bridges/x.ts', plant)).toHaveLength(1)
    expect(findDirectIo('src/screens/bridge/x.ts', plant)).toHaveLength(1)
  })
})
