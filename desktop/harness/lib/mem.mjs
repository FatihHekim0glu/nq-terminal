import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// Whole-tree memory under rootPid. windowsHide keeps the PowerShell child from opening a console.
export function memTree(rootPid) {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'mem.ps1'), '-RootPid', String(rootPid)],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  return JSON.parse(out)
}

// Current identity ({ pid, created, exe }) of each pid that still exists, in the same form mem.ps1 records it.
export function liveIdentity(pids) {
  const ids = [...new Set(pids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  if (ids.length === 0) return []
  const script = `$ids = @(${ids.join(',')}); $r = @(Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ProcessId } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; exe = $_.Name; created = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }) } }); ConvertTo-Json -InputObject $r -Compress`
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const rows = JSON.parse(out || '[]')
  return Array.isArray(rows) ? rows : [rows]
}

// Identity rows of rootPid and its creation-time-checked descendants (no performance counters, so it is quick).
export function treeIdentity(rootPid) {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'mem.ps1'), '-RootPid', String(rootPid), '-WalkOnly', '-Identity'],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const rows = JSON.parse(out || '[]')
  return Array.isArray(rows) ? rows : [rows]
}
