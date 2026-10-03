// Self-tests of the desktop project's own guards, each born failing (04 standing rule: a check must fail on the broken
// state before it is trusted): the window judge, the quiet-machine guard, the launch prelude and the switch line.
import { attachTarget } from './attach.ts'
import { launchArgs, launchEnv, cleanPath, endOwnedTree, OWNER_PORT } from './launch.ts'
import fs from 'node:fs'
import path from 'node:path'
import { BUSY, foreignRuns, LOCK_NAME, ownTree, tryAcquireRunLock, type ProcRow } from './quiet.ts'
import { expect, test } from './fixtures.ts'
import { judge, TAO_CLASS, type WatchEvent } from './watch.ts'

const window_ = (over: Partial<WatchEvent>): WatchEvent => ({ event: 'new', pid: 4242, process: 'planted', class: 'Planted', title: '', rect: [0, 0, 100, 100], drawn: true, ...over })

test.describe('the project guards fail on planted trouble', () => {
  test('the window judge passes tao\'s unseen event window and fails everything else', () => {
    expect(judge([window_({ class: TAO_CLASS, drawn: false })])).toEqual([])
    expect(judge([{ event: 'ready' }, { event: 'done', samples: 10, maxGapMs: 120 }])).toEqual([])
    for (const planted of [
      window_({ drawn: true }),
      window_({ class: TAO_CLASS, drawn: true }),
      window_({ class: 'Chrome_WidgetWin_1', drawn: false }),
      window_({ event: 'foreground', drawn: false }),
    ]) {
      expect(judge([planted]), JSON.stringify(planted)).toHaveLength(1)
    }
  })

  test('the window judge names whose tree a window came from', () => {
    const ours = window_({ chain: [{ pid: 4242, name: 'msedgewebview2.exe', commandLine: '' }, { pid: 77, name: 'nq-lab-terminal.exe', commandLine: '' }] })
    expect(judge([ours], 77)[0]).toContain("this run's app tree")
    expect(judge([ours], 99)[0]).toContain('NOT this run')
  })

  test('the quiet-machine guard sees another Playwright or vitest run', () => {
    for (const line of [
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\x\\node_modules\\@playwright\\test\\cli.js" test --config e2e/perf/real.config.ts',
      'node C:\\x\\node_modules\\.pnpm\\@playwright+test@1.63.0\\node_modules\\@playwright\\test\\lib\\worker\\process.js',
      'node C:\\x\\node_modules\\vitest\\vitest.mjs run --maxWorkers=8',
      'C:\\WINDOWS\\system32\\cmd.exe /d /s /c playwright test --project=chromium',
    ]) {
      expect(BUSY.test(line), line).toBe(true)
    }
    for (const line of ['C:\\Windows\\System32\\svchost.exe -k netsvcs', '"C:\\Program Files\\nodejs\\node.exe" scripts/buildStamp.mjs']) {
      expect(BUSY.test(line), line).toBe(false)
    }
  })

  test("the quiet-machine guard sees another desktop run, and exempts only this run's own tree", () => {
    const cli = '"C:\\Program Files\\nodejs\\node.exe" "C:\\x\\node_modules\\@playwright\\test\\cli.js" test -c playwright.desktop.config.ts'
    const table: ProcRow[] = [
      { pid: 1, ppid: 0, commandLine: 'explorer.exe' },
      { pid: 10, ppid: 1, commandLine: 'cmd.exe /d /s /c pnpm e2e:desktop' },
      { pid: 11, ppid: 10, commandLine: cli }, // this run's main process
      { pid: 12, ppid: 11, commandLine: 'node C:\\x\\node_modules\\@playwright\\test\\lib\\worker\\process.js' }, // its worker
      { pid: 20, ppid: 1, commandLine: 'cmd.exe /d /s /c pnpm e2e:desktop' },
      { pid: 21, ppid: 20, commandLine: cli }, // a second desktop run, another worktree or a manual start
    ]
    const pids = (lines: string[]): string[] => lines.map((l) => l.split('\t')[0] ?? '')
    const tree = ownTree(table, 11)
    expect([11, 10, 1, 12].every((pid) => tree.has(pid)), 'itself, its wrappers and its worker').toBe(true)
    expect([20, 21].some((pid) => tree.has(pid)), 'a sibling run under the same shell is not its own').toBe(false)
    expect(pids(foreignRuns(table, 11))).toEqual(['21'])
    expect(pids(foreignRuns(table, 21))).toEqual(['11', '12'])
    // with the lock held the other desktop run is a waiter; a browser run of another kind is still seen
    expect(foreignRuns(table, 11, true)).toEqual([])
    const vitest: ProcRow = { pid: 30, ppid: 1, commandLine: 'node C:\\x\\node_modules\\vitest\\vitest.mjs run' }
    expect(pids(foreignRuns([...table, vitest], 11, true))).toEqual(['30'])
  })

  test('the desktop lock admits one run, keeps a live holder, replaces a stale one and is released by its owner only', () => {
    const dir = fs.mkdtempSync(path.join(process.env.NQT_APP_RUNS ?? 'D:/dev/d5/app', 'lock-'))
    try {
      const alive = new Map<number, string>([[101, 'start-A'], [202, 'start-B']])
      const startTime = (p: number): string | null => alive.get(p) ?? null
      const first = tryAcquireRunLock(dir, 101, startTime)
      expect(first).not.toBeNull()
      expect(tryAcquireRunLock(dir, 202, startTime), 'a live holder keeps it').toBeNull()
      alive.set(101, 'start-C') // pid 101 reused by a younger process: the lock is stale
      const second = tryAcquireRunLock(dir, 202, startTime)
      expect(second).not.toBeNull()
      first?.release() // not the owner any more: must leave the lock alone
      expect(fs.existsSync(path.join(dir, LOCK_NAME))).toBe(true)
      second?.release()
      expect(fs.existsSync(path.join(dir, LOCK_NAME))).toBe(false)
      fs.writeFileSync(path.join(dir, LOCK_NAME), 'not json')
      expect(tryAcquireRunLock(dir, 101, startTime), 'an unreadable lock counts as held').toBeNull()
      alive.delete(202)
      fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: 202, startedAt: 'start-B', cwd: '' }))
      expect(tryAcquireRunLock(dir, 101, startTime), 'a dead holder is replaced').not.toBeNull()
      expect(() => tryAcquireRunLock('C:/Windows/Temp/nqt-lock', 1, startTime)).toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the launch prelude strips a planted MinGW and cargo folder from PATH and every WEBVIEW2 variable', () => {
    const planted = 'C:\\Windows;D:\\dev\\mingw\\mingw64\\bin;C:\\Tools;d:\\dev\\cargo\\bin;D:\\dev\\mingw-extra\\bin'
    expect(cleanPath(planted)).toBe('C:\\Windows;C:\\Tools')
    const env = launchEnv({ PATH: planted, WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'x', webview2_user_data_folder: 'y', KEEP: 'z' })
    expect(env.PATH).toBe('C:\\Windows;C:\\Tools')
    expect(Object.keys(env).filter((n) => n.toUpperCase().startsWith('WEBVIEW2_'))).toEqual([])
    expect(env.KEEP).toBe('z')
  })

  test('the attach variables name one loopback shell, never the owner\'s port, and only both together', () => {
    expect(attachTarget({})).toBeNull()
    expect(attachTarget({ NQT_DESKTOP_ATTACH_CDP: '', NQT_DESKTOP_ATTACH_URL: '' })).toBeNull()
    expect(attachTarget({ NQT_DESKTOP_ATTACH_CDP: '9222', NQT_DESKTOP_ATTACH_URL: 'http://127.0.0.1:4373/' })).toEqual({ cdpUrl: 'http://127.0.0.1:9222', origin: 'http://127.0.0.1:4373' })
    for (const planted of [
      { NQT_DESKTOP_ATTACH_CDP: '9222' },
      { NQT_DESKTOP_ATTACH_URL: 'http://127.0.0.1:4373/' },
      { NQT_DESKTOP_ATTACH_CDP: '9222', NQT_DESKTOP_ATTACH_URL: `http://127.0.0.1:${OWNER_PORT}/` },
      { NQT_DESKTOP_ATTACH_CDP: String(OWNER_PORT), NQT_DESKTOP_ATTACH_URL: 'http://127.0.0.1:4373/' },
      { NQT_DESKTOP_ATTACH_CDP: 'x', NQT_DESKTOP_ATTACH_URL: 'http://127.0.0.1:4373/' },
      { NQT_DESKTOP_ATTACH_CDP: '9222', NQT_DESKTOP_ATTACH_URL: 'http://example.com:4373/' },
      { NQT_DESKTOP_ATTACH_CDP: '9222', NQT_DESKTOP_ATTACH_URL: 'http://localhost:4373/' },
    ]) {
      expect(() => attachTarget(planted), JSON.stringify(planted)).toThrow()
    }
  })

  test('the switch line asks for a fixture, debugging port 0 and the run folders, and never for 8765', () => {
    const dirs = { saveDir: 'D:\\dev\\d5\\app\\s', stateDir: 'D:\\dev\\d5\\app\\t', configDir: 'D:\\dev\\d5\\app\\c', webviewDir: 'D:\\dev\\d5\\app\\w' }
    const args = launchArgs({ exe: 'x', fixture: true, lab: 'D:\\lab', runDir: 'D:\\dev\\d5\\app', size: '1920x1080' }, dirs)
    expect(args).toContain('--fixture')
    expect(args.slice(args.indexOf('--remote-debugging-port'), args.indexOf('--remote-debugging-port') + 2)).toEqual(['--remote-debugging-port', '0'])
    expect(args).toEqual(expect.arrayContaining(['--webview-data-dir', dirs.webviewDir, '--config-dir', dirs.configDir, '--state-dir', dirs.stateDir, '--save-dir', dirs.saveDir, '--size', '1920x1080']))
    expect(args.join(' ')).not.toContain(String(OWNER_PORT))
    expect(launchArgs({ exe: 'x', fixture: false, lab: 'D:\\lab', runDir: 'D:\\r' }, dirs)).not.toContain('--fixture')
  })
  test('the tree kill goes only to a child that has not exited, so a reused pid is never ended', () => {
    const killed: number[] = []
    const kill = (pid: number): void => void killed.push(pid)
    // the child's exit event has fired: its pid may belong to anyone now, even though a probe of the number succeeds
    expect(endOwnedTree(4242, () => true, { kill, probe: () => true })).toBe(false)
    expect(killed).toEqual([])
    // still running and ours: the tree is ended
    expect(endOwnedTree(4242, () => false, { kill, probe: () => true })).toBe(true)
    expect(killed).toEqual([4242])
    // running by the exit flag but already gone by the probe: nothing to end
    expect(endOwnedTree(4243, () => false, { kill, probe: () => false })).toBe(false)
    expect(killed).toEqual([4242])
  })
})
