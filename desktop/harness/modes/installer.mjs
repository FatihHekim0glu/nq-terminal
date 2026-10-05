// The installer row: the size of the NSIS installer file (target 15 MB, ceiling 30 MB). build-release.ps1 writes the installer
// under D:\dev\release\<version>\; `--installer <file>` names one explicitly. No window and no process: a file size.
import fs from 'node:fs'
import path from 'node:path'
import { RELEASE_ROOT } from '../lib/paths.mjs'
import { rowById, verdictOf, MB } from '../lib/rows.mjs'
import { figure, writeRecord } from '../lib/record.mjs'

/** The newest release *_x64-setup.exe under the release root (one folder per version), or null; the measure and install-test installers beside it are other builds. */
export function findInstaller(root = RELEASE_ROOT) {
  let found = []
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      for (const f of fs.readdirSync(path.join(root, d.name))) if (/_x64-setup\.exe$/i.test(f) && !/ (measure|installtest)_/i.test(f)) found.push(path.join(root, d.name, f))
    }
  } catch { return null }
  found = found.map((f) => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m)
  return found[0]?.f ?? null
}

export async function run({ args, outDir, provenance }) {
  const file = args.opt('installer', null) ?? findInstaller()
  if (!file || !fs.existsSync(file)) throw new Error('no installer found; build one (desktop\\scripts\\build-release.ps1) or pass --installer <file>')
  const bytes = fs.statSync(file).size
  const row = rowById('installer_mb')
  const value = Math.round((bytes / MB) * 100) / 100
  const fig = figure({ row: 'installer_mb', build: 'release', value, unit: 'MB', method: row.method.release, cpuLoadPct: null, provenance, extra: { file, bytes } })
  writeRecord(outDir, 'installer', { mode: 'installer', build: 'release', status: args.flag('dry') ? 'dry' : 'accepted', kind: args.flag('dry') ? 'dry' : 'measure', provenance, rows: { installer_mb: value }, figures: [fig], file, bytes, watch: { clean: true, newWindows: [], foregroundChanges: [] } })
  console.log(JSON.stringify({ mode: 'installer', file, bytes, mb: value, verdict: verdictOf(row, value) }))
  return { file, bytes, value }
}
