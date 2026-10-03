// Global set-up of the desktop project (playwright.desktop.config.ts): starts the global window watch, then launches the
// hidden smoke build with `--fixture` (fixture_main: the same synthetic serve and catalogue as the browser fixture backend),
// `--size 1920x1080` and debugging port 0 (with NQT_DESKTOP_MODE=real, which scripts/smoke_real.ps1 -Mode App sets, the real
// backend over the lab NQT_APP_LAB names, no --fixture), reads DevToolsActivePort and hands what the specs need to them in a run file
// (NQT_DESKTOP_RUN_FILE). With NQT_DESKTOP_ATTACH_CDP and NQT_DESKTOP_ATTACH_URL set (the harness's t8 mode, e2e/desktop/attach.ts)
// it launches nothing and attaches to the shell the harness started. The function it returns is the tear-down: it ends the process tree this set-up started (and only
// that), stops the watch, writes the run record and fails the run when the watch saw a window or a foreground change or
// when a backend outlived the shell.
import fs from 'node:fs'
import path from 'node:path'
import { attachTarget, type AttachTarget } from './attach.ts'
import { findSmokeExe, launchApp, newRunDir, resolveLab } from './launch.ts'
import { waitForQuietMachine, type RunLock } from './quiet.ts'
import { RUN_FILE_ENV, type RunInfo } from './run.ts'
import { judge, startWatch } from './watch.ts'

const WINDOW_SIZE = '1920x1080'

/** The real-data smoke's app mode: the real backend over the real lab, never the fixture. */
export const realMode = (): boolean => process.env.NQT_DESKTOP_MODE === 'real'

/**
 * The attach mode of the measurement harness (t8): a shell it started and watches itself. Nothing is launched, watched or
 * stopped here; the specs get the debugging port and the origin, and no folder of a shell that is not ours.
 */
function attachSetup(target: AttachTarget): () => Promise<void> {
  const runDir = newRunDir('attach')
  const info: RunInfo = { pid: 0, cdpUrl: target.cdpUrl, origin: target.origin, runDir, saveDir: '', stateDir: '', configDir: '', watchLog: '', exe: '', lab: '' }
  const runFile = path.join(runDir, 'run.json')
  fs.writeFileSync(runFile, JSON.stringify(info, null, 2))
  process.env[RUN_FILE_ENV] = runFile
  return async () => undefined
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const target = attachTarget(process.env)
  if (target !== null) return attachSetup(target)
  const lock = await waitForQuietMachine()
  process.once('exit', () => lock.release())
  try {
    return await desktopSetup(lock)
  } catch (error) {
    lock.release()
    throw error
  }
}

async function desktopSetup(lock: RunLock): Promise<() => Promise<void>> {
  const runDir = newRunDir(realMode() ? 'smoke-app' : 'desktop')
  const watchLog = path.join(runDir, 'watch.jsonl')
  const watch = await startWatch(watchLog)
  let exe = ''
  let lab = ''
  let launched: Awaited<ReturnType<typeof launchApp>>
  try {
    exe = findSmokeExe()
    lab = resolveLab()
    launched = await launchApp({ exe, fixture: !realMode(), lab, runDir, size: WINDOW_SIZE })
  } catch (error) {
    await watch.finish().catch(() => undefined)
    throw error
  }
  const info: RunInfo = {
    pid: launched.pid,
    cdpUrl: launched.cdpUrl,
    origin: launched.origin,
    runDir,
    saveDir: launched.saveDir,
    stateDir: launched.stateDir,
    configDir: launched.configDir,
    watchLog,
    exe,
    lab,
  }
  const runFile = path.join(runDir, 'run.json')
  fs.writeFileSync(runFile, JSON.stringify(info, null, 2))
  process.env[RUN_FILE_ENV] = runFile
  return async () => {
    try {
      await tearDown()
    } finally {
      lock.release()
    }
  }
  async function tearDown(): Promise<void> {
    const stopped = await launched.stop()
    const report = await watch.finish()
    const failures = judge(report.events, launched.pid)
    if (!stopped.backendGone) failures.push(`the backend (pid ${stopped.backendPid}) outlived the shell's tree`)
    fs.writeFileSync(path.join(runDir, 'record.json'), JSON.stringify({ ...info, stopped, watch: { samples: report.samples, maxGapMs: report.maxGapMs, failures } }, null, 2))
    if (failures.length > 0) throw new Error(`the desktop run left a mark on the machine:\n${failures.join('\n')}`)
  }
}
