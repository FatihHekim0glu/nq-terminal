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
  4. The run, over fake ports: graceful (0, with the shutdown mode spawned, attached or none), timed out without -Force
     (3, never stopped), forced (4, the listed process object only), no evidence (5), no closable window (1, nothing
     sent), a failed post (1, no wait, no stop), an open confirm question (6, never stopped, even with -Force), not
     running (2), dry run (0, nothing sent). The close goes to the picked window only, and Alive and Stop receive the
     process object the listing returned, never a bare id.
  4b. The image name rule: only 'nq-lab-terminal' or nqt-test-<lowercase, digits, hyphens>.
  5. The script itself, with the real ports and an image name no process has (nqt-test-no-such-image): exit 2;
     -ImageName explorer: exit 1 before any process is listed; -TimeoutSeconds 0: exit 1. No window is enumerated for
     another program's process and no message is sent.
  6. The real ports on a hidden stand-in process (a copy of the Windows shell named nqt-test-live-<n>.exe, killed at
     the end): the listing returns a System.Diagnostics.Process, Alive follows it, Stop ends it.
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
# The fake Processes port lists records { Id, Name, Owner, Process } like the real one; Process is the object the Alive and
# Stop ports must receive (never a bare id). A LogAfter entry 'event:mode' writes a "mode" field, 'event' alone none.
# LogBefore lines carry a time before the request and must not count.
function New-FakePorts {
    param(
        [int]$ExitAfterPosts = 1,
        [string[]]$LogAfter = @('store_flush', 'supervise_shutdown:spawned'),
        [string[]]$LogBefore = @(),
        [object[]]$Windows = @($tao, $sic, $main),
        [int]$Count = 1,
        [bool]$PostResult = $true,
        [string[]]$LateLog = @(),
        [long]$LateAtMs = 0,
        [long]$StartMs = 1000
    )
    $state = [pscustomobject]@{
        Now = 10000L; Posts = New-Object System.Collections.Generic.List[long]
        Stops = New-Object System.Collections.Generic.List[object]; AliveArgs = New-Object System.Collections.Generic.List[object]
        Listed = New-Object System.Collections.Generic.List[object]; Sleeps = 0; Exited = $false
    }
    $line = {
        param($Entry, $Stamp)
        $name, $mode = $Entry -split ':', 2
        $modeJson = if ($mode) { ',"mode":"' + $mode + '"' } else { '' }
        '{"event":"' + $name + '"' + $modeJson + ',"t":' + $Stamp + '}'
    }
    $ports = [pscustomobject]@{
        Owner     = 'PC\me'
        Processes = {
            param($Image)
            @(1..$Count | Where-Object { $Count -gt 0 } | ForEach-Object {
                    $proc = [pscustomobject]@{ Id = 100 + $_; Tag = "listed-$_" }
                    $state.Listed.Add($proc)
                    [pscustomobject]@{ Id = 100 + $_; Name = "$Image.exe"; Owner = 'PC\me'; Process = $proc }
                })
        }.GetNewClosure()
        Windows   = { param($ProcessId) $Windows }.GetNewClosure()
        Post      = {
            param($Handle)
            $state.Posts.Add([long]$Handle)
            if ($PostResult -and $ExitAfterPosts -gt 0 -and $state.Posts.Count -ge $ExitAfterPosts) { $state.Exited = $true }
            return $PostResult
        }.GetNewClosure()
        Alive     = { param($Proc) $state.AliveArgs.Add($Proc); -not $state.Exited }.GetNewClosure()
        Stop      = { param($Proc) $state.Stops.Add($Proc); $state.Exited = $true }.GetNewClosure()
        LogPath   = 'fake'
        LogLines  = {
            param($Path)
            $late = if (($state.Now - 10000L) -ge $LateAtMs) { @($LateLog | ForEach-Object { & $line $_ $state.Now }) } else { @() }
            @(@($LogBefore | ForEach-Object { & $line $_ 5000 }) + @($LogAfter | ForEach-Object { & $line $_ $state.Now }) + $late)
        }.GetNewClosure()
        StartMs   = { param($Proc) $StartMs }.GetNewClosure()
        NowMs     = { $state.Now }.GetNewClosure()
        Sleep     = { param($Ms) $state.Sleeps++; $state.Now += [long]$Ms }.GetNewClosure()
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
Add-Result 'run: -Force stops the shell once (4)' ($r.Code -eq 4 -and $f.State.Stops.Count -eq 1) "code $($r.Code), stops $($f.State.Stops.Count)"
Add-Result 'run: the stop goes to the listed process object, not to an id' (
    $f.State.Stops.Count -eq 1 -and $f.State.Listed.Count -eq 1 -and [object]::ReferenceEquals($f.State.Stops[0], $f.State.Listed[0]))
$aliveOnListed = @($f.State.AliveArgs | Where-Object { -not [object]::ReferenceEquals($_, $f.State.Listed[0]) }).Count -eq 0
Add-Result 'run: the liveness check also uses the listed process object' ($f.State.AliveArgs.Count -gt 0 -and $aliveOnListed) "alive calls $($f.State.AliveArgs.Count)"

$f = New-FakePorts -LogAfter @('store_flush')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: an exit without the shutdown line is no evidence (5)' ($r.Code -eq 5) "code $($r.Code)"

$f = New-FakePorts -LogAfter @('supervise_shutdown:spawned')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: an exit without store_flush is no evidence (5), the gap is named' (
    $r.Code -eq 5 -and $r.Results[0].Detail -match 'store_flush') "code $($r.Code): $($r.Results[0].Detail)"

# supervise_shutdown now appears on every path with a mode field: spawned, attached or none.
foreach ($mode in @('spawned', 'attached', 'none')) {
    $f = New-FakePorts -LogAfter @('store_flush', "supervise_shutdown:$mode")
    $r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
    Add-Result "run: store_flush and supervise_shutdown (mode $mode) is graceful (0) and names the mode" (
        $r.Code -eq 0 -and $r.Results[0].Status -eq 'graceful' -and $r.Results[0].Detail -match "mode $mode") "code $($r.Code): $($r.Results[0].Detail)"
}

$f = New-FakePorts -Windows @($tao, $sic)
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: only helper windows sends nothing (1)' ($r.Code -eq 1 -and $f.State.Posts.Count -eq 0) "code $($r.Code), posts $($f.State.Posts.Count)"

$f = New-FakePorts -Count 0
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: no process is not running (2)' ($r.Code -eq 2) "code $($r.Code)"

$f = New-FakePorts
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $true
Add-Result 'run: a dry run sends nothing (0)' ($r.Code -eq 0 -and $f.State.Posts.Count -eq 0 -and $r.Results[0].Status -eq 'dry-run') "code $($r.Code), posts $($f.State.Posts.Count)"

# A backtest the owner has not answered about: the app asked "close anyway?" (close_confirm_asked after the request).
foreach ($force in @($false, $true)) {
    $f = New-FakePorts -ExitAfterPosts 0 -LogAfter @('close_confirm_asked')
    $r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $force $false
    Add-Result "run: an open confirm question is confirm-pending (6) and never stops the shell (-Force $force)" (
        $r.Code -eq 6 -and $r.Results[0].Status -eq 'confirm-pending' -and $f.State.Stops.Count -eq 0) "code $($r.Code), stops $($f.State.Stops.Count)"
}
# V033B review: a question the owner opened before the request is still unanswered afterwards (the posted close waits
# behind the modal dialog, so no new close_confirm_asked follows). It is pending, with or without -Force.
foreach ($force in @($false, $true)) {
    $f = New-FakePorts -ExitAfterPosts 0 -LogBefore @('store_flush', 'close_confirm_asked')
    $r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $force $false
    Add-Result "run: a confirm question asked before the request is confirm-pending (6), never stopped (-Force $force)" (
        $r.Code -eq 6 -and $r.Results[0].Status -eq 'confirm-pending' -and $f.State.Stops.Count -eq 0) "code $($r.Code), stops $($f.State.Stops.Count)"
}
$f = New-FakePorts -ExitAfterPosts 0 -LogBefore @('store_flush', 'close_confirm_asked', 'close_confirm_answered')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $false $false
Add-Result 'run: a question answered before the request does not count (3)' ($r.Code -eq 3) "code $($r.Code)"
# The owner answers Close after the request: store_flush was logged before the question, so before the request. That is
# one close, and the graceful exit stays graceful. A store_flush of an earlier, finished close does not count.
$f = New-FakePorts -LogBefore @('store_flush', 'close_confirm_asked') -LogAfter @('close_confirm_answered', 'supervise_shutdown:spawned')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: a question open at the request, answered Close, with store_flush logged before it, is graceful (0)' (
    $r.Code -eq 0 -and $r.Results[0].Status -eq 'graceful' -and $r.Results[0].Detail -match 'mode spawned') "code $($r.Code): $($r.Results[0].Detail)"
$f = New-FakePorts -LogBefore @('store_flush', 'supervise_shutdown:spawned') -LogAfter @('supervise_shutdown:spawned')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: a store_flush of an earlier finished close is no evidence (5)' ($r.Code -eq 5) "code $($r.Code)"
$f = New-FakePorts -LogAfter @('close_confirm_asked', 'store_flush', 'supervise_shutdown:spawned')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: a question the owner answered yes to, with the shell gone and the evidence logged, is graceful (0)' ($r.Code -eq 0) "code $($r.Code)"
Add-Result 'overall: confirm-pending outranks a timeout, a forced stop and every other result' (
    (Get-OverallCode @([pscustomobject]@{ Status = 'timeout' }, [pscustomobject]@{ Status = 'forced' }, [pscustomobject]@{ Status = 'confirm-pending' })) -eq 6)

# V033B review: -Force must not stop a shell that is about to ask, or one with an earlier question still open.
# 1. The flush budget (4 s) and the job count read (2 s) come before close_confirm_asked: -Force waits at least 15 s.
$f = New-FakePorts -ExitAfterPosts 0 -LateLog @('close_confirm_asked') -LateAtMs 8000
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 5 $true $false
Add-Result 'force: a question logged 8 s after the request, with -TimeoutSeconds 5, is confirm-pending (6) and nothing is stopped' (
    $r.Code -eq 6 -and $f.State.Stops.Count -eq 0) "code $($r.Code), stops $($f.State.Stops.Count)"
$f = New-FakePorts -ExitAfterPosts 0
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $true $false
Add-Result 'force: the wait is raised to the floor before the stop (15 s)' (
    $r.Code -eq 4 -and $f.State.Stops.Count -eq 1 -and ($f.State.Now - 10000L) -ge 15000L) "code $($r.Code), waited $($f.State.Now - 10000L) ms"
$f = New-FakePorts -ExitAfterPosts 0
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $false $false
Add-Result 'force: without -Force the timeout is not raised' ($r.Code -eq 3 -and ($f.State.Now - 10000L) -lt 15000L) "waited $($f.State.Now - 10000L) ms"
# 2. A question left open by an earlier run (logged before this request, after the shell started) still protects the shell.
$f = New-FakePorts -ExitAfterPosts 0 -LogBefore @('close_confirm_asked')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $true $false
Add-Result 'force: a question left open by an earlier run is confirm-pending (6), never stopped' (
    $r.Code -eq 6 -and $f.State.Stops.Count -eq 0) "code $($r.Code), stops $($f.State.Stops.Count)"
$f = New-FakePorts -ExitAfterPosts 0 -LogBefore @('close_confirm_asked', 'close_confirm_answered')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $true $false
Add-Result 'force: an answered earlier question no longer protects the shell (4)' ($r.Code -eq 4 -and $f.State.Stops.Count -eq 1) "code $($r.Code)"
$f = New-FakePorts -ExitAfterPosts 0 -LogBefore @('close_confirm_asked') -StartMs 6000
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $true $false
Add-Result 'force: a question from before this shell started does not count (4)' ($r.Code -eq 4 -and $f.State.Stops.Count -eq 1) "code $($r.Code)"
$walk = @('{"event":"close_confirm_asked","t":10}', '{"event":"close_confirm_answered","t":20}', '{"event":"close_confirm_asked","t":30}')
Add-Result 'log: the newest ask with no later answer is open; an answered one is not' (
    (Test-OpenQuestion $walk 0) -and -not (Test-OpenQuestion $walk[0..1] 0) -and -not (Test-OpenQuestion $walk 31))

# A log that is missing or unreadable is not "no confirm question": the LogLines port returns nothing (not even an empty
# line) when the log was not read. Nothing may be stopped then, not even with -Force, and the status names the cause.
function New-UnreadableLogPorts {
    param([int]$ExitAfterPosts = 0)
    $fake = New-FakePorts -ExitAfterPosts $ExitAfterPosts
    $fake.Ports.LogLines = { param($Path) }
    return $fake
}
foreach ($force in @($false, $true)) {
    $f = New-UnreadableLogPorts
    $r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $force $false
    Add-Result "run: an unreadable log on a timeout is log-unreadable (3) and never stops the shell (-Force $force)" (
        $r.Code -eq 3 -and $r.Results[0].Status -eq 'log-unreadable' -and $f.State.Stops.Count -eq 0 -and $r.Results[0].Detail -match 'log') (
        "code $($r.Code), status $($r.Results[0].Status), stops $($f.State.Stops.Count): $($r.Results[0].Detail)")
}
$f = New-UnreadableLogPorts -ExitAfterPosts 1
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: a shell that exits while the log is unreadable is no evidence (5) and says the log could not be read' (
    $r.Code -eq 5 -and $r.Results[0].Status -eq 'no-evidence' -and $r.Results[0].Detail -match 'could not be read') "code $($r.Code): $($r.Results[0].Detail)"
$f = New-FakePorts -ExitAfterPosts 0 -LogAfter @('store_flush')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 2 $true $false
Add-Result 'run: a readable log with no confirm event still lets -Force stop the shell (4)' ($r.Code -eq 4 -and $f.State.Stops.Count -eq 1) "code $($r.Code), stops $($f.State.Stops.Count)"
Add-Result 'overall: log-unreadable exits 3, below confirm-pending and above forced' (
    (Get-OverallCode @([pscustomobject]@{ Status = 'log-unreadable' })) -eq 3 -and
    (Get-OverallCode @([pscustomobject]@{ Status = 'forced' }, [pscustomobject]@{ Status = 'log-unreadable' })) -eq 3 -and
    (Get-OverallCode @([pscustomobject]@{ Status = 'log-unreadable' }, [pscustomobject]@{ Status = 'confirm-pending' })) -eq 6)
$missingLog = Join-Path ([System.IO.Path]::GetTempPath()) ("nqt-closeapp-missing-" + [guid]::NewGuid().ToString('N') + '.log')
Add-Result 'log: Get-LogTail on a missing file returns nothing (not read)' (@(Get-LogTail $missingLog).Count -eq 0)
$emptyLog = Join-Path ([System.IO.Path]::GetTempPath()) ("nqt-closeapp-empty-" + [guid]::NewGuid().ToString('N') + '.log')
[System.IO.File]::WriteAllBytes($emptyLog, [byte[]]@())
try {
    Add-Result 'log: Get-LogTail on an empty file that was read returns one element, so it differs from a missing log' (@(Get-LogTail $emptyLog).Count -eq 1)
} finally { Remove-Item -LiteralPath $emptyLog -Force -ErrorAction SilentlyContinue }

# The question comes late: the shell holds the first close for the store flush (up to 4 s plus the page answers) before it
# asks. A short -TimeoutSeconds with -Force must not kill it before the question has been put, and the question is noticed
# as soon as it is logged, not only at the deadline.
$f = New-FakePorts -ExitAfterPosts 0 -LogBefore @('store_flush') -LogAfter @() -LateLog @('close_confirm_asked') -LateAtMs 6000
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 3 $true $false
Add-Result 'run: -TimeoutSeconds 3 -Force with the question asked at 6 s never kills (6)' (
    $r.Code -eq 6 -and $f.State.Stops.Count -eq 0) "code $($r.Code), stops $($f.State.Stops.Count)"
$f = New-FakePorts -ExitAfterPosts 0 -LogBefore @('store_flush') -LogAfter @() -LateLog @('close_confirm_asked') -LateAtMs 1000
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
Add-Result 'run: the question is reported as soon as it is logged, not after the full timeout' (
    $r.Code -eq 6 -and ($f.State.Now - 10000L) -le 3000) "code $($r.Code), waited $($f.State.Now - 10000L) ms"
$f = New-FakePorts -ExitAfterPosts 0 -LogAfter @('store_flush') -LateLog @('close_confirm_asked') -LateAtMs 18000
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 15 $true $false
Add-Result 'run: -Force does not kill while the close sequence is under way (flushed, not yet shut down) and the question follows (6)' (
    $r.Code -eq 6 -and $f.State.Stops.Count -eq 0) "code $($r.Code), stops $($f.State.Stops.Count)"
$f = New-FakePorts -ExitAfterPosts 0 -LogAfter @('store_flush')
$r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 15 $true $false
Add-Result 'run: a shell stuck after the flush for the whole extra grace is stopped once (4)' (
    $r.Code -eq 4 -and $f.State.Stops.Count -eq 1) "code $($r.Code), stops $($f.State.Stops.Count)"

# A request that could not be posted: no wait, no stop.
foreach ($force in @($false, $true)) {
    $f = New-FakePorts -PostResult $false -ExitAfterPosts 0
    $r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $force $false
    Add-Result "run: a failed post is post-failed (1) with no wait and no stop (-Force $force)" (
        $r.Code -eq 1 -and $r.Results[0].Status -eq 'post-failed' -and $f.State.Sleeps -eq 0 -and $f.State.AliveArgs.Count -eq 0 -and $f.State.Stops.Count -eq 0) (
        "code $($r.Code), sleeps $($f.State.Sleeps), alive $($f.State.AliveArgs.Count), stops $($f.State.Stops.Count)")
}
Add-Result 'overall: post-failed ranks as an error (1), below no evidence' (
    (Get-OverallCode @([pscustomobject]@{ Status = 'post-failed' })) -eq 1 -and
    (Get-OverallCode @([pscustomobject]@{ Status = 'post-failed' }, [pscustomobject]@{ Status = 'no-evidence' })) -eq 5)

# A process of the image that the listing could not vet (handle, owner or start time) is reported as skipped, never dropped:
# exit 1, so exit 2 only ever means that no such process exists.
function New-SkippedRecord {
    param([int]$Id, [string]$Name = 'nq-lab-terminal.exe', [string]$Owner = '', [string]$Reason = 'access denied')
    return [pscustomobject]@{ Id = $Id; Name = $Name; Owner = $Owner; Process = $null; Skipped = $true; Reason = $Reason }
}
$skippedMix = @(
    (New-SkippedRecord 201), (New-SkippedRecord 202 -Owner 'PC\me'), (New-SkippedRecord 203 -Owner 'PC\other'),
    (New-SkippedRecord 204 -Name 'notepad.exe'), [pscustomobject]@{ Id = 205; Name = 'nq-lab-terminal.exe'; Owner = 'PC\me'; Process = 'p' })
Add-Result 'skipped: Select-OwnProcess never returns a skipped record' (@(Select-OwnProcess $skippedMix 'PC\me' 'nq-lab-terminal' @()).Id -join ',' -eq '205')
Add-Result 'skipped: unknown or own owner and the image count, another user''s or another image''s do not' (
    (@(Select-SkippedProcess $skippedMix 'PC\me' 'nq-lab-terminal' @()).Id -join ',') -eq '201,202')
Add-Result 'skipped: -ProcessId narrows the skipped list too' (
    (@(Select-SkippedProcess $skippedMix 'PC\me' 'nq-lab-terminal' @(202)).Id -join ',') -eq '202' -and
    @(Select-SkippedProcess $skippedMix 'PC\me' 'nq-lab-terminal' @(999)).Count -eq 0)

foreach ($case in @(
        @{ Name = 'only a skipped process'; Records = @((New-SkippedRecord 201)); Code = 1 },
        @{ Name = 'a skipped process beside a gone-graceful one'; Records = @((New-SkippedRecord 201), 'LIVE'); Code = 1 },
        @{ Name = 'only another user''s skipped process'; Records = @((New-SkippedRecord 203 -Owner 'PC\other')); Code = 2 })) {
    $f = New-FakePorts
    $records = $case.Records
    $f.Ports.Processes = {
        param($Image)
        @($records | ForEach-Object {
                if ($_ -eq 'LIVE') { [pscustomobject]@{ Id = 101; Name = "$Image.exe"; Owner = 'PC\me'; Process = [pscustomobject]@{ Tag = 'live' } } } else { $_ }
            })
    }.GetNewClosure()
    $r = Invoke-CloseApp $f.Ports 'nq-lab-terminal' @() 30 $false $false
    Add-Result "run: $($case.Name) exits $($case.Code)" ($r.Code -eq $case.Code) "code $($r.Code)"
    if ($case.Code -eq 1) {
        $skip = @($r.Results | Where-Object { $_.Status -eq 'skipped' })
        Add-Result "run: $($case.Name) is reported with pid and reason" ($skip.Count -eq 1 -and $skip[0].ProcessId -eq 201 -and $skip[0].Detail -match 'access denied') (($skip.Detail) -join '')
        Add-Result "run: $($case.Name) stops nothing" ($f.State.Stops.Count -eq 0)
    }
}
Add-Result 'overall: skipped is an error (1) and ranks below no evidence' (
    (Get-OverallCode @([pscustomobject]@{ Status = 'skipped' })) -eq 1 -and
    (Get-OverallCode @([pscustomobject]@{ Status = 'skipped' }, [pscustomobject]@{ Status = 'no-evidence' })) -eq 5)

# Get-ProcessRecords (the vetting inside the real Processes port), on fake CIM rows and fake handles.
function New-FakeHandle {
    param([datetime]$Start = [datetime]::Now, [string]$ProcessName = 'nqt-test-x')
    $h = [pscustomobject]@{ Handle = 1; StartTime = $Start; ProcessName = $ProcessName; Disposed = $false }
    Add-Member -InputObject $h -MemberType ScriptMethod -Name Dispose -Value { $this.Disposed = $true }
    return $h
}
function New-FakeCim {
    param([int]$Id = 300, [datetime]$Created = [datetime]::Now)
    return [pscustomobject]@{ ProcessId = $Id; Name = 'nqt-test-x.exe'; CreationDate = $Created }
}
$ownerMe = { param($c) [pscustomobject]@{ User = 'me'; Domain = 'PC' } }
$now = [datetime]::Now

$rec = @(Get-ProcessRecords 'nqt-test-x' @((New-FakeCim 300 $now)) $ownerMe { param($i) New-FakeHandle $now })
Add-Result 'records: a vetted process is returned with its owner and handle object' (
    $rec.Count -eq 1 -and -not $rec[0].Skipped -and $rec[0].Owner -eq 'PC\me' -and $rec[0].Id -eq 300 -and $null -ne $rec[0].Process)

$handle = New-FakeHandle $now.AddSeconds(30)
$rec = @(Get-ProcessRecords 'nqt-test-x' @((New-FakeCim 301 $now)) $ownerMe { param($i) $handle }.GetNewClosure())
Add-Result 'records: a start-time skew over 2 s is skipped with the reason and the handle disposed' (
    $rec.Count -eq 1 -and $rec[0].Skipped -and $rec[0].Reason -match 'start time' -and $rec[0].Id -eq 301 -and $handle.Disposed) (($rec.Reason) -join '')

$handle = New-FakeHandle $now 'notepad'
$rec = @(Get-ProcessRecords 'nqt-test-x' @((New-FakeCim 302 $now)) $ownerMe { param($i) $handle }.GetNewClosure())
Add-Result 'records: a handle with another image name is skipped with the reason and disposed' (
    $rec.Count -eq 1 -and $rec[0].Skipped -and $rec[0].Reason -match 'image name' -and $handle.Disposed) (($rec.Reason) -join '')

$rec = @(Get-ProcessRecords 'nqt-test-x' @((New-FakeCim 303 $now)) $ownerMe { param($i) throw (New-Object System.ComponentModel.Win32Exception 5) })
Add-Result 'records: access denied when opening is skipped with the reason' ($rec.Count -eq 1 -and $rec[0].Skipped -and $rec[0].Reason -match 'open') (($rec.Reason) -join '')

if (-not ('NqtDeniedHandle' -as [type])) {
    Add-Type -TypeDefinition 'public sealed class NqtDeniedHandle { public System.IntPtr Handle { get { throw new System.ComponentModel.Win32Exception(5); } } public void Dispose() { } }'
}
$handleNoRead = New-Object NqtDeniedHandle
$rec = @(Get-ProcessRecords 'nqt-test-x' @((New-FakeCim 304 $now)) $ownerMe { param($i) $handleNoRead }.GetNewClosure())
Add-Result 'records: access denied on the handle is skipped with the reason' ($rec.Count -eq 1 -and $rec[0].Skipped -and $rec[0].Reason -match 'handle') (($rec.Reason) -join '')

$rec = @(Get-ProcessRecords 'nqt-test-x' @((New-FakeCim 305 $now)) { param($c) [pscustomobject]@{ User = $null; Domain = $null } } { param($i) New-FakeHandle $now })
Add-Result 'records: an unreadable owner is skipped with the reason, not dropped' ($rec.Count -eq 1 -and $rec[0].Skipped -and $rec[0].Reason -match 'owner') (($rec.Reason) -join '')
$rec = @(Get-ProcessRecords 'nqt-test-x' @((New-FakeCim 306 $now)) { param($c) throw 'cim failed' } { param($i) New-FakeHandle $now })
Add-Result 'records: a failing owner lookup is skipped with the reason' ($rec.Count -eq 1 -and $rec[0].Skipped -and $rec[0].Reason -match 'owner') (($rec.Reason) -join '')

# A process that ended between the listing and the open is gone, not skipped (GetProcessById throws ArgumentException).
$rec = @(Get-ProcessRecords 'nqt-test-x' @((New-FakeCim 307 $now)) $ownerMe { param($i) throw (New-Object System.ArgumentException 'not running') })
Add-Result 'records: a process that has already ended is not reported' ($rec.Count -eq 0)
$rec = @(Get-ProcessRecords 'nqt-test-x' @((New-FakeCim 308 $now)) $ownerMe { param($i) [System.Diagnostics.Process]::GetProcessById(2147483000) })
Add-Result 'records: the real GetProcessById error for an unknown id is not reported (wrapped ArgumentException)' ($rec.Count -eq 0)

# ---- 4b. the image name rule -------------------------------------------------------------------------------------------
Add-Result 'image: the app and nqt-test-* stand-ins are allowed' (
    (Test-ImageNameAllowed 'nq-lab-terminal') -and (Test-ImageNameAllowed 'nqt-test-no-such-image') -and (Test-ImageNameAllowed 'nqt-test-a1'))
$refused = @('explorer', 'notepad', 'NQ-LAB-TERMINAL', 'nqt-test-', 'nqt-test-A', 'nqt-test-a b', 'nqt-test-a.exe', 'xnqt-test-a', 'nq-lab-terminal2', '')
$allowedRefused = @($refused | Where-Object { Test-ImageNameAllowed $_ })
Add-Result 'image: any other name is refused' ($allowedRefused.Count -eq 0) ($allowedRefused -join ',')

# ---- 5. the script itself ----------------------------------------------------------------------------------------------
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Script -ImageName 'nqt-test-no-such-image' -DryRun 2>&1 | ForEach-Object { "$_" }
Add-Result 'script: an image no process has exits 2' ($LASTEXITCODE -eq 2) (($out -join ' ') -replace '\s+', ' ')
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Script -ImageName 'explorer' -DryRun 2>&1 | ForEach-Object { "$_" }
Add-Result 'script: another program (explorer) is refused (1) before any process is listed' (
    $LASTEXITCODE -eq 1 -and (($out -join ' ') -match 'ERROR') -and (($out -join ' ') -notmatch 'process \d+')) (($out -join ' ') -replace '\s+', ' ')
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Script -TimeoutSeconds 0 2>&1 | ForEach-Object { "$_" }
Add-Result 'script: a timeout under 1 s is refused (1)' ($LASTEXITCODE -eq 1) (($out -join ' ') -replace '\s+', ' ')

# ---- 6. the real ports, on a stand-in process --------------------------------------------------------------------------
# A copy of the Windows shell named nqt-test-live-<n>.exe sleeps hidden; it has no window. The real Processes port must
# list it as a record with a System.Diagnostics.Process, Alive must follow that object, Stop must end that object only.
$standIn = $null
$standDir = Join-Path ([System.IO.Path]::GetTempPath()) ("nqt-closeapp-" + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $standDir | Out-Null
    $imageName = 'nqt-test-live-' + (Get-Random -Maximum 1000000)
    $standExe = Join-Path $standDir "$imageName.exe"
    Copy-Item -LiteralPath (Join-Path $PSHOME 'powershell.exe') -Destination $standExe
    $standIn = Start-Process -FilePath $standExe -ArgumentList '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 600
    $real = New-Win32Ports (Join-Path $standDir 'no.log')
    $listed = @(& $real.Processes $imageName)
    $isProcess = ($listed.Count -eq 1) -and ($listed[0].Process -is [System.Diagnostics.Process]) -and ($listed[0].Id -eq $standIn.Id)
    Add-Result 'real ports: the listing returns a System.Diagnostics.Process for the stand-in' $isProcess "listed $($listed.Count)"
    if ($isProcess) {
        $mine = @(Select-OwnProcess $listed $real.Owner $imageName @())
        Add-Result 'real ports: the stand-in is this user''s and matches the image' ($mine.Count -eq 1) $real.Owner
        Add-Result 'real ports: Alive is true while the stand-in runs' ((& $real.Alive $listed[0].Process) -eq $true)
        & $real.Stop $listed[0].Process
        [void]$listed[0].Process.WaitForExit(5000)
        Add-Result 'real ports: Stop ends that process and Alive turns false' ((& $real.Alive $listed[0].Process) -eq $false)
        & $real.Stop $listed[0].Process
        Add-Result 'real ports: a second Stop on the exited process does not throw' $true
    }
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Script -ImageName $imageName -DryRun 2>&1 | ForEach-Object { "$_" }
    Add-Result 'script: after the stand-in is gone its image is not running (2)' ($LASTEXITCODE -eq 2) (($out -join ' ') -replace '\s+', ' ')
} catch {
    Add-Result 'real ports: the stand-in run completed' $false $_.Exception.Message
} finally {
    if ($null -ne $standIn -and -not $standIn.HasExited) { $standIn.Kill() }
    Remove-Item -LiteralPath $standDir -Recurse -Force -ErrorAction SilentlyContinue
}

$failed = @($Results | Where-Object { -not $_.passed }).Count
Write-Host ("close-app tests: {0} passed, {1} failed" -f ($Results.Count - $failed), $failed)
exit $failed
