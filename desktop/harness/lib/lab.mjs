// The lab a launch runs on. The shell accepts a lab only when the backend it starts reports that lab as its ROOT (02 C3-2),
// and ROOT is read from where `nq_lab` is installed. Run from the main tree, the owner's lab is used as it is. Run from
// another tree (a worktree), a derived lab under the run folder is built, as the shell's own hidden-window tests do:
//   .venv      the owner's venv launcher and pyvenv.cfg (copied) and one .pth file that puts the derived `src` first and
//              adds the owner's site-packages as a site folder, so `nq_lab` is the derived copy and its ROOT the derived lab;
//   src\nq_lab a copy of the research package sources (read only use, never written back);
//   terminal   a junction to the terminal under test, or (isolateState) a folder of junctions to every entry of it except
//              `state`, so a backend that keeps its state under <lab>\terminal\state writes into the run folder instead.
// Nothing here writes outside the run folder, and no data folder of the lab is ever linked.
import fs from 'node:fs'
import path from 'node:path'
import { LAB, TERMINAL, isMainTree } from './paths.mjs'

const SKIP = new Set(['__pycache__'])

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const a = path.join(from, e.name)
    const b = path.join(to, e.name)
    if (e.isDirectory()) copyTree(a, b)
    else fs.copyFileSync(a, b)
  }
}

export function junction(link, target) {
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.symlinkSync(target, link, 'junction')
}

function derivedVenv(lab, real) {
  const venv = path.join(lab, '.venv')
  fs.mkdirSync(path.join(venv, 'Scripts'), { recursive: true })
  fs.copyFileSync(path.join(real, '.venv', 'Scripts', 'python.exe'), path.join(venv, 'Scripts', 'python.exe'))
  fs.copyFileSync(path.join(real, '.venv', 'pyvenv.cfg'), path.join(venv, 'pyvenv.cfg'))
  const site = path.join(venv, 'Lib', 'site-packages')
  fs.mkdirSync(site, { recursive: true })
  const packages = path.join(real, '.venv', 'Lib', 'site-packages')
  fs.writeFileSync(path.join(site, 'nqt_derived.pth'), `${path.join(lab, 'src')}\nimport site; site.addsitedir(r"${packages}")\n`, 'utf8')
}

function isolatedTerminal(link, terminal) {
  fs.mkdirSync(link, { recursive: true })
  for (const e of fs.readdirSync(terminal, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'state' || e.name === '.git' || e.name === 'node_modules') continue
    if (e.name === 'backend') copyTree(path.join(terminal, 'backend', 'nq_terminal'), path.join(link, 'backend', 'nq_terminal'))
    else junction(path.join(link, e.name), path.join(terminal, e.name))
  }
}

/** A lab for a launch from `terminal`. Returns { lab, derived, remove() }. */
export function makeLab(runDir, { terminal = TERMINAL, real = LAB, isolateState = false, force = false } = {}) {
  if (!force && !isolateState && isMainTree()) return { lab: real, derived: false, remove() {} }
  const lab = path.join(runDir, 'lab')
  derivedVenv(lab, real)
  copyTree(path.join(real, 'src', 'nq_lab'), path.join(lab, 'src', 'nq_lab'))
  if (isolateState) isolatedTerminal(path.join(lab, 'terminal'), terminal)
  else junction(path.join(lab, 'terminal'), terminal)
  return { lab, derived: true, remove: () => dropLab(lab) }
}

/** Removes the junctions of a derived lab before its folder is deleted, so a recursive delete never follows one. */
export function dropLab(lab) {
  for (const base of [lab, path.join(lab, 'terminal')]) {
    let entries = []
    try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = path.join(base, e.name)
      if (fs.lstatSync(p).isSymbolicLink()) fs.rmdirSync(p)
    }
  }
  if (hasLinks(lab)) return false // never delete recursively through a junction that could not be removed
  try { fs.rmSync(lab, { recursive: true, force: true }) } catch { /* left for the next cleanup */ }
  return true
}

function hasLinks(dir) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  return entries.some((e) => { const p = path.join(dir, e.name); return fs.lstatSync(p).isSymbolicLink() || (e.isDirectory() && hasLinks(p)) })
}

/** The measure build's settings file: the lab it runs on (it takes no switch; NQT_MEASURE_DIR names the run folder). */
export function writeMeasureSettings(runDir, lab) {
  const file = path.join(runDir, 'config', 'settings.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ lab }), 'utf8')
  return file
}
