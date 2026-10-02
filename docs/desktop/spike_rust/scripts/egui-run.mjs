// Runner for the egui spike: spawns the exe hidden, samples memory at idle and mid-work, collects the result JSON.
// Usage: node run.mjs <mode> <runIdx> <outDir> [extra args]
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [mode, runIdx, outDir, ...extra] = process.argv.slice(2)
const EXE = 'D:\\dev\\spikes\\native-egui\\target\\release\\nq-native-egui.exe'
const MEM = 'D:\\dev\\spikes\\tauri-shell\\drive\\mem.ps1'
fs.mkdirSync(outDir, { recursive: true })
const log = path.join(outDir, `${mode}-${runIdx}.log`)
const out = path.join(outDir, `${mode}-${runIdx}.json`)
fs.rmSync(log, { force: true }); fs.rmSync(out, { force: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mem = (pid) => JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', MEM, '-RootPid', String(pid)], { encoding: 'utf8' }))
const marks = () => (fs.existsSync(log) ? Object.fromEntries(fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' '))) : {})

const t0 = Date.now()
const child = spawn(EXE, ['--mode', mode, '--secs', '9', '--idle-ms', '4000', '--out', out, '--log', log, ...extra], { windowsHide: true, stdio: 'ignore' })
const res = { mode, run: Number(runIdx), cpuBefore: null }
try {
  const wait = async (key, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const m = marks(); if (m[key]) return Number(m[key]); await sleep(25) } return null }
  const ff = await wait('first_frame', 60_000)
  res.spawnToFirstFrameMs = ff ? ff - t0 : null
  const m0 = marks(); res.milestones = Object.fromEntries(Object.entries(m0).map(([k, v]) => [k, Number(v) - t0]))
  await sleep(2500)               // inside the 4 s idle window
  const idle = mem(child.pid); res.memIdle = idle
  const ws = await wait('work_start', 20_000)
  await sleep(3500)
  const work = mem(child.pid); res.memWork = work
  res.cpuTotalDuringWork = work.cpuTotalPct
  await wait('done', 30_000)
  res.milestones = Object.fromEntries(Object.entries(marks()).map(([k, v]) => [k, Number(v) - t0]))
  res.app = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null
} catch (e) { res.fatal = String(e) } finally {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* gone */ }
}
fs.writeFileSync(path.join(outDir, `${mode}-${runIdx}.run.json`), JSON.stringify(res, null, 1))
const mb = (b) => b && (b / 1048576).toFixed(0)
console.log(JSON.stringify({ mode, run: runIdx, firstFrame: res.spawnToFirstFrameMs, idlePrivMB: mb(res.memIdle?.wsPrivate), idleWsMB: mb(res.memIdle?.ws), workPrivMB: mb(res.memWork?.wsPrivate), workWsMB: mb(res.memWork?.ws), nproc: res.memIdle?.n, frames: res.app?.frames, interval: res.app?.interval_ms, ui: res.app?.ui_cpu_ms, fatal: res.fatal }))
