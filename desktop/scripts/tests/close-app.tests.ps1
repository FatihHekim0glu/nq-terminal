<#
.SYNOPSIS
  Tests of desktop\scripts\close-app.ps1 (V033).

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\tests\close-app.tests.ps1

  1. The window rule, on fake windows: the titled, unowned window that is neither tao's event target nor a
     single-instance helper is picked (a visible one first); with only the helpers, or only untitled or owned windows,
     nothing is picked.
  2. The process rule: only the image name, only this user, and only the given ids when there are any.
  3. The log reading: only events at or after the request count, and a cut or foreign line is skipped.
  4. The run, over fake ports: graceful (0), timed out without -Force (3, never stopped), forced (4, the shell pid
     only), no evidence (5), no closable window (1, nothing sent), not running (2), dry run (0, nothing sent). The close
     goes to the picked window only.
  5. The script itself, with the real ports and an image name no process has: exit 2, and -TimeoutSeconds 0: exit 1.
     No window is enumerated for another program's process and no message is sent.
  Exit code: the number of failed checks.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Script = Join-Path (Split-Path $PSScriptRoot -Parent) 'close-app.ps1'
$Results = New-Object System.Collections.Generic.List[object]

function Add-Result {
    param([string]$Name, [bool]$Passed, [string]$Detail = '')
    $Results.Add([pscustomobject]@{ name = $Name; passed = $Passed })
    Write-Host ("{0}  {1}{2}" -f $(if ($Passed) { 'PASS' } else { 'FAIL' }), $Name, $(if ($Detail) { "  ($Detail)" } else { '' }))
}

. $Script -LibraryOnly

function New-Window {
    param([long]$Handle, [string]$Class, [string]$Title, [bool]$Visible, [long]$Owner = 0)
    return [pscustomobject]@{ Handle = $Handle; OwnerHandle = $Owner; Class = $Class; Title = $Title; Visible = $Visible }
}

$tao = New-Window 11 'Tao Thread Event Target' '' $true
$sic = New-Window 12 'dev.nqlab.terminal-sic' 'dev.nqlab.terminal-siw' $true
$main = New-Window 13 'Tauri Window' 'nq-lab terminal' $false
$dialog = New-Window 14 '#32770' 'nq-lab terminal' $true 13

# ---- 1. the window rule ------------------------------------------------------------------------------------------------
$picked = Select-CloseWindow @($tao, $sic, $main)
Add-Result 'window: the app window is picked over the visible helpers' ($null -ne $picked -and $picked.Handle -eq 13)
Add-Result 'window: only the helpers means nothing to close' ($null -eq (Select-CloseWindow @($tao, $sic)))
$untitled = New-Window 15 'Tauri Window' '' $true
Add-Result 'window: an untitled or owned window is never picked' ($null -eq (Select-CloseWindow @($untitled, $dialog, $tao)))
$hiddenOther = New-Window 16 'Tauri Window' 'other' $false
$visibleMain = New-Window 17 'Tauri Window' 'nq-lab terminal' $true
$pick2 = Select-CloseWindow @($hiddenOther, $visibleMain)
Add-Result 'window: a visible candidate wins' ($null -ne $pick2 -and $pick2.Handle -eq 17)
$semverSic = New-Window 18 'dev.nqlab.terminal_0.3-sic' 'x' $true
Add-Result 'window: a semver single-instance helper is never picked' ($null -eq (Select-CloseWindow @($semverSic)))

# ---- 2. the process rule -----------------------------------------------------------------------------------------------
$procs = @(
    [pscustomobject]@{ Id = 1; Name = 'nq-lab-terminal.exe'; Owner = 'PC\me' },
    [pscustomobject]@{ Id = 2; Name = 'nq-lab-terminal.exe'; Owner = 'PC\other' },
    [pscustomobject]@{ Id = 3; Name = 'notepad.exe'; Owner = 'PC\me' },
    [pscustomobject]@{ Id = 4; Name = 'NQ-LAB-TERMINAL.EXE'; Owner = 'pc\ME' }
)
$own = @(Select-OwnProcess $procs 'PC\me' 'nq-lab-terminal' @())
Add-Result 'process: only this user and this image' (($own.Id -join ',') -eq '1,4')
$one = @(Select-OwnProcess $procs 'PC\me' 'nq-lab-terminal' @(4, 2, 3))
Add-Result 'process: -ProcessId narrows and never widens' (($one.Id -join ',') -eq '4')

# ---- 3. the log reading ------------------------------------------------------------------------------------------------
$lines = @(
    'p","t":1000}',
    '{"event":"store_flush","t":900}',
    '{"event":"store_flush","t":1000}',
    'not json',
    '{"event":"supervise_shutdown","t":1500}',
    '{"t":1600}',
    ''
)
$events = @(Get-LogEvents $lines 1000)
Add-Result 'log: only events at or after the request' (($events -join ',') -eq 'store_flush,supervise_shutdown') ($events -join ',')
Add-Result 'log: missing evidence is named' ((@(Get-MissingEvidence @('store_flush')) -join ',') -eq 'supervise_shutdown')

# ---- 4. the run over fake ports ----------------------------------------------------------------------------------------
function New-FakePorts {
    param([int]$ExitAfterPosts = 1, [string[]]$LogAfter = @('store_flush', 'supervise_shutdown'), [object[]]$Windows = @($tao, $sic, $main), [int]$Count = 1)
    $state = [pscustomobject]@{ Now = 10000L; Posts = New-Object System.Collections.Generic.List[long]; Stops = New-Object System.Collections.Generic.List[int]; Exited = $false }
    $ports = [pscustomobject]@{
        Owner     = 'PC\me'
        Processes = { param($Image) @(1..$Count | Where-Object { $Count -gt 0 } | ForEach-Object { [pscustomobject]@{ Id = 100 + $_; Name = "$Image.exe"; Owner = 'PC\me' } }) }.GetNewClosure()
        Windows   = { param($ProcessId) $Windows }.GetNewClosure()
        Post      = { param($Handle) $state.Posts.Add([long]$Handle); if ($ExitAfterPosts -gt 0 -and $state.Posts.Count -ge $ExitAfterPosts) { $state.Exited = $true } }.GetNewClosure()
        Alive     = { param($ProcessId) -not $state.Exited }.GetNewClosure()
        Stop      = { param($ProcessId) $state.Stops.Add([int]$ProcessId); $state.Exited = $true }.GetNewClosure()
        LogPath   = 'fake'
        LogLines  = { param($Path) @($LogAfter | ForEach-Object { '{"event":"' + $_ + '","t":' + ($state.Now) + '}' }) }.GetNewClosure()
        NowMs     = { $state.Now }.GetNewClosure()
        Sleep     = { param($Ms) $state.Now += [long]$Ms }.GetNewClosure()
    }
    return [pscustomobject]@{ Ports = $ports; State = $state }
}

$f = New-FakePorts
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: graceful close exits 0' ($r.Code -eq 0) "code $($r.Code)"
Add-Result 'run: the close went to the app window only' (($f.State.Posts -join ',') -eq '13') ($f.State.Posts -join ',')

$f = New-FakePorts -ExitAfterPosts 0
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $false $false
Add-Result 'run: a shell that stays is a timeout (3) and is never stopped' ($r.Code -eq 3 -and $f.State.Stops.Count -eq 0) "code $($r.Code), stops $($f.State.Stops.Count)"

$f = New-FakePorts -ExitAfterPosts 0
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $true $false
Add-Result 'run: -Force stops the shell pid only (4)' ($r.Code -eq 4 -and ($f.State.Stops -join ',') -eq '101') "code $($r.Code), stops $($f.State.Stops -join ',')"

$f = New-FakePorts -LogAfter @('store_flush')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: an exit without the shutdown line is no evidence (5)' ($r.Code -eq 5) "code $($r.Code)"

$f = New-FakePorts -Windows @($tao, $sic)
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: only helper windows sends nothing (1)' ($r.Code -eq 1 -and $f.State.Posts.Count -eq 0) "code $($r.Code), posts $($f.State.Posts.Count)"

$f = New-FakePorts -Count 0
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: no process is not running (2)' ($r.Code -eq 2) "code $($r.Code)"

$f = New-FakePorts
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $true
Add-Result 'run: a dry run sends nothing (0)' ($r.Code -eq 0 -and $f.State.Posts.Count -eq 0 -and $r.Results[0].Status -eq 'dry-run') "code $($r.Code), posts $($f.State.Posts.Count)"

# ---- 5. the script itself ----------------------------------------------------------------------------------------------
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Script -ImageName 'nqt-no-such-image' -DryRun 2>&1 | ForEach-Object { "$_" }
Add-Result 'script: an image no process has exits 2' ($LASTEXITCODE -eq 2) (($out -join ' ') -replace '\s+', ' ')
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Script -TimeoutSeconds 0 2>&1 | ForEach-Object { "$_" }
Add-Result 'script: a timeout under 1 s is refused (1)' ($LASTEXITCODE -eq 1) (($out -join ' ') -replace '\s+', ' ')

$failed = @($Results | Where-Object { -not $_.passed }).Count
Write-Host ("close-app tests: {0} passed, {1} failed" -f ($Results.Count - $failed), $failed)
exit $failed
