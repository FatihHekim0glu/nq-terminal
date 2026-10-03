param([int]$RootPid, [string]$TableJson = '', [switch]$WalkOnly, [switch]$Identity)
# Whole-tree memory of a process and all its descendants from the Win32 performance counters
# (adapted from desktop_research/spike_rust/scripts/mem.ps1). Private working set is the figure of record.
# A child is adopted only when it was created at or after its parent: an orphan whose dead parent's pid was reused
# by a newer process is older than that process and is not part of its tree.
if ($TableJson) {
  $all = @((Get-Content -Raw -LiteralPath $TableJson | ConvertFrom-Json) | ForEach-Object {
    [pscustomobject]@{ ProcessId = [int]$_.ProcessId; ParentProcessId = [int]$_.ParentProcessId; Name = $_.Name; Created = ([datetime]$_.Created).ToUniversalTime() } })
} else {
  $all = @(Get-CimInstance Win32_Process | ForEach-Object {
    [pscustomobject]@{ ProcessId = [int]$_.ProcessId; ParentProcessId = [int]$_.ParentProcessId; Name = $_.Name; Created = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime() } else { $null }) } })
}
$byId = @{}
foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
$ids = New-Object System.Collections.Generic.HashSet[int]
[void]$ids.Add($RootPid)
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($p in $all) {
    $pid2 = [int]$p.ProcessId
    if ($ids.Contains($pid2) -or -not $ids.Contains([int]$p.ParentProcessId)) { continue }
    $parent = $byId[[int]$p.ParentProcessId]
    if ($null -eq $p.Created -or $null -eq $parent -or $null -eq $parent.Created -or $p.Created -lt $parent.Created) { continue }
    [void]$ids.Add($pid2); $changed = $true
  }
}
if ($WalkOnly -and $Identity) {
  $rows = @($ids | Sort-Object | ForEach-Object { $m = $byId[[int]$_]; if ($m) { [pscustomobject]@{ pid = [int]$_; exe = $m.Name; created = $(if ($m.Created) { $m.Created.ToString('o') } else { $null }) } } })
  ConvertTo-Json -InputObject $rows -Compress; exit 0
}
if ($WalkOnly) { ConvertTo-Json -InputObject @($ids | Sort-Object) -Compress; exit 0 }
$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids.Contains([int]$_.IDProcess) }
$rows = $perf | ForEach-Object {
  $meta = $byId[[int]$_.IDProcess]
  [pscustomobject]@{ pid = $_.IDProcess; name = $_.Name; exe = $(if ($meta) { $meta.Name } else { $null }); created = $(if ($meta -and $meta.Created) { $meta.Created.ToString('o') } else { $null }); ws = [int64]$_.WorkingSet; wsPrivate = [int64]$_.WorkingSetPrivate; privateBytes = [int64]$_.PrivateBytes } }
$cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
[pscustomobject]@{ n = @($rows).Count; ws = ($rows | Measure-Object ws -Sum).Sum; wsPrivate = ($rows | Measure-Object wsPrivate -Sum).Sum; privateBytes = ($rows | Measure-Object privateBytes -Sum).Sum; cpuTotalPct = $cpu; procs = $rows } | ConvertTo-Json -Depth 4 -Compress
