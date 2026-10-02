param([int]$RootPid)
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
$ids = New-Object System.Collections.Generic.HashSet[int]
[void]$ids.Add($RootPid)
$changed = $true
while ($changed) { $changed = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $changed = $true } } }
$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids.Contains([int]$_.IDProcess) }
$rows = $perf | ForEach-Object { [pscustomobject]@{ pid = $_.IDProcess; name = $_.Name; ws = [int64]$_.WorkingSet; wsPrivate = [int64]$_.WorkingSetPrivate; privateBytes = [int64]$_.PrivateBytes } }
$cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
[pscustomobject]@{ n = @($rows).Count; ws = ($rows | Measure-Object ws -Sum).Sum; wsPrivate = ($rows | Measure-Object wsPrivate -Sum).Sum; privateBytes = ($rows | Measure-Object privateBytes -Sum).Sum; cpuTotalPct = $cpu; procs = $rows } | ConvertTo-Json -Depth 4 -Compress
