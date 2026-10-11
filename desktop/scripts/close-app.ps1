<#
.SYNOPSIS
  Closes the running nq-lab terminal app gracefully, the way a person closing its window does (V033).

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\close-app.ps1 [-ProcessId <pid>[,<pid>]] [-TimeoutSeconds 30] [-Force] [-DryRun]

  What it does, for the current user's nq-lab-terminal.exe processes only (-ProcessId narrows that list further; a pid
  of another image name or another user is never touched):
    1. Lists the top-level windows of each process (EnumWindows, GetClassName, GetWindowTextLength, GW_OWNER) and
       picks the one to close: the class is neither 'Tao Thread Event Target' nor ends in '-sic' (the windowing
       library's event target and the single-instance helper, both invisible), the title is not empty, and the window
       has no owner. A visible window is preferred. This is the rule of desktop\harness\lib\winctl.mjs. Select-CloseWindow
       is a pure function so the rule is tested without windows.
    2. Posts WM_CLOSE to that one window, the request a title-bar close or Task Manager makes. It never shows,
       focuses, moves, minimises or resizes a window, and it never touches the app's port.
    3. Waits up to -TimeoutSeconds (default 30) for the shell process to exit, then reads the app's shell log
       (%APPDATA%\dev.nqlab.terminal\logs\shell.log, opened read only, newest 512 KB) for the events store_flush and
       supervise_shutdown written after the request. Both present and the process gone is graceful. The shell writes
       supervise_shutdown on every close path, with a mode field (spawned, attached or none); the mode is reported.
    4. If the log holds close_confirm_asked after the request and the shell is still running, a backtest is running
       and the app is asking the owner whether to close: it reports 'confirm-pending' and exits 6. It never stops
       the shell in that case, not even with -Force: the owner has not answered.
       The shell asks only after its flush budget (4 s) and the job count read (2 s), so -Force waits at least 15 s
       whatever -TimeoutSeconds says, reads the log again right before any stop, and also treats a question still
       open from an earlier invocation (close_confirm_asked since the shell started, with no close_confirm_answered
       after it) as confirm-pending, with or without -Force. A close the owner answers Close after the request is
       graceful even though its store_flush was logged before the question. The wait reads the log about once a second,
       so the question is reported as soon as it is logged, not at the deadline. With -Force, a shell that has logged
       store_flush but not supervise_shutdown is given 10 s more before any stop, so a question still on its way is
       seen first.
    5. On a timeout without -Force it reports and exits 3 and never kills. With -Force it stops the shell process
       only (the backend ends through the job object and the closed stdin, as seen on 7 October 2026) and reports
       'forced' (exit 4).
  Process identity: the processes are listed as System.Diagnostics.Process objects whose handle is opened while listing
  (and checked against the creation time the listing reported). The liveness check and the stop use that same object,
  never a lookup by process id, so a pid the system reuses after the shell exits can never be waited on or killed.
  If the close request cannot be posted (PostMessage returns false) it reports 'post-failed' and exits 1 at once: no
  waiting, no stop.
  -DryRun lists the processes and prints which window it would close; it posts nothing and waits for nothing.
  The output holds process ids, window classes and titles and the names of log events. It prints no environment value.

  Exit codes:
    0  graceful: the shell exited and its log shows store_flush and supervise_shutdown after the request
        (with -DryRun: a window was found and nothing was sent)
    1  error: a process of the image was skipped (its handle, owner or start time could not be checked, for example an
        elevated app; a SKIPPED line gives the id and the reason, and nothing was closed or stopped for it), bad arguments (including a refused -ImageName), a running shell with no closable window (nothing was
        sent), or a close request that could not be posted
    2  not running: no nq-lab-terminal.exe process of this user exists (or none of the given -ProcessId values). It is
        never printed for a process that was listed but could not be checked (that is exit 1)
    3  timed out: the shell was still running after -TimeoutSeconds and -Force was not given; also the status
        'log-unreadable': the shell is still running and the shell log is missing or could not be read, so an open
        backtest question cannot be ruled out. Nothing is stopped, not even with -Force (check -LogPath)
    4  forced: the shell did not exit in time and was stopped with -Force
    5  exited without evidence: the shell exited but the log lacks store_flush or supervise_shutdown after the request
    6  confirm pending: a backtest is running and the app is asking whether to close; nothing was stopped
  With several shells the worst result decides: 6, then 3, then 4, then 5, then 1, then 0.
.PARAMETER ProcessId
  Only these process ids (still restricted to the image name and to this user).
.PARAMETER TimeoutSeconds
  How long to wait for the shell to exit after the request. Default 30.
.PARAMETER Force
  On a timeout, stop the shell process (never its children, never another program). Waits at least 15 s, whatever
  -TimeoutSeconds says, and never stops a shell with an unanswered close question.
.PARAMETER DryRun
  Print which window would be closed and send nothing.
.PARAMETER LogPath
  The shell log to read. Default %APPDATA%\dev.nqlab.terminal\logs\shell.log. Test hook.
.PARAMETER ImageName
  The image name to look for, without .exe. Default nq-lab-terminal. Any other value is refused (exit 1, before any
  process is listed) unless it matches ^nqt-test-[a-z0-9-]+$, the stand-in names of tests\close-app.tests.ps1. This
  keeps the script from ever closing, or force-stopping, another program.
.PARAMETER LibraryOnly
  Define the functions and return (dot-sourced by tests\close-app.tests.ps1).
#>
[CmdletBinding()]
param(
    [int[]]$ProcessId = @(),
    [int]$TimeoutSeconds = 30,
    [switch]$Force,
    [switch]$DryRun,
    [string]$LogPath = '',
    [string]$ImageName = 'nq-lab-terminal',
    [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaoClass = 'Tao Thread Event Target'
$SingleInstanceSuffix = '-sic'
$WaitPollMs = 250
$LogTailBytes = 512KB
$RequiredEvents = @('store_flush', 'supervise_shutdown')
$DefaultIdentifier = 'dev.nqlab.terminal'
$ExitGraceful = 0
$ExitError = 1
$ExitNotRunning = 2
$ExitTimedOut = 3
$ExitForced = 4
$ExitNoEvidence = 5
$ExitConfirmPending = 6
$AppImageName = 'nq-lab-terminal'
$TestImagePattern = '^nqt-test-[a-z0-9-]+\z'
$ConfirmEvent = 'close_confirm_asked'
$ConfirmAnsweredEvent = 'close_confirm_answered'
# The shell holds a close for its 4 s flush budget, then reads the job count (2 s link timeout), and only then asks.
# -Force therefore never waits less than this, whatever -TimeoutSeconds says.
$ForceMinTimeoutSeconds = 15
# With -Force, a shell that has flushed but not logged its shutdown is given this much longer before it is stopped.
$CloseSequenceGraceSeconds = 10
# How often the wait reads the log for the close question (the log tail is up to 512 KB).
$LogPollMs = 1000

# ---- pure rules (tested without windows or processes) -------------------------------------------------------------------

function Test-ImageNameAllowed {
    # Only the app itself, or a lowercase nqt-test-* stand-in of the tests. Case sensitive on purpose.
    param([string]$Name)
    if ($Name -ceq $AppImageName) { return $true }
    return ($Name -cmatch $TestImagePattern)
}

function Test-CloseCandidate {
    # The window rule of harness\lib\winctl.mjs: not the Tao event target, not a single-instance helper, a title, no owner.
    param($Window)
    if ($Window.Class -eq $TaoClass) { return $false }
    if ($Window.Class.EndsWith($SingleInstanceSuffix, [System.StringComparison]::Ordinal)) { return $false }
    if ([string]::IsNullOrEmpty($Window.Title)) { return $false }
    if ($Window.OwnerHandle -ne 0) { return $false }
    return $true
}

function Select-CloseWindow {
    # The one window to close, or $null. A visible candidate wins over a hidden one; otherwise enumeration order decides.
    param([object[]]$Windows)
    $candidates = @($Windows | Where-Object { Test-CloseCandidate $_ })
    if ($candidates.Count -eq 0) { return $null }
    $visible = @($candidates | Where-Object { $_.Visible })
    if ($visible.Count -gt 0) { return $visible[0] }
    return $candidates[0]
}

function Test-SkippedRecord {
    # A record the listing could not vet carries Skipped = $true and a Reason (records of the test ports may lack the field).
    param($Record)
    return ($null -ne $Record.PSObject.Properties['Skipped']) -and ($Record.Skipped -eq $true)
}

function Select-OwnProcess {
    # The processes this run may touch: the image name, this user, and (when given) one of the wanted ids. A skipped
    # record (see Select-SkippedProcess) is never one of them: it has no process object.
    param([object[]]$Processes, [string]$Owner, [string]$Image, [int[]]$Wanted)
    return @($Processes | Where-Object {
            (-not (Test-SkippedRecord $_)) -and ($_.Name -ieq "$Image.exe") -and ($_.Owner -ieq $Owner) -and ((@($Wanted).Count -eq 0) -or (@($Wanted) -contains $_.Id))
        })
}

function Select-SkippedProcess {
    # The processes of the image (and of the wanted ids) that the listing could not vet and that may be this user's: the
    # owner is unknown (empty) or this user. Another user's process is none of this run's business.
    param([object[]]$Processes, [string]$Owner, [string]$Image, [int[]]$Wanted)
    return @($Processes | Where-Object {
            (Test-SkippedRecord $_) -and ($_.Name -ieq "$Image.exe") -and ([string]::IsNullOrEmpty($_.Owner) -or ($_.Owner -ieq $Owner)) -and
            ((@($Wanted).Count -eq 0) -or (@($Wanted) -contains $_.Id))
        })
}

function Get-LogEvents {
    # The event names of the shell log lines written at or after SinceMs (the log's own "t", epoch milliseconds).
    # A line that is not JSON, or has no t or event, is skipped: the log's first line in a tail may be cut.
    param([string[]]$Lines, [long]$SinceMs)
    $names = New-Object System.Collections.Generic.List[string]
    foreach ($line in @($Lines)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $entry = $line | ConvertFrom-Json } catch { continue }
        $props = @($entry.PSObject.Properties.Name)
        if (($props -notcontains 't') -or ($props -notcontains 'event')) { continue }
        $stamp = 0L
        if (-not [long]::TryParse([string]$entry.t, [ref]$stamp)) { continue }
        if ($stamp -ge $SinceMs) { $names.Add([string]$entry.event) }
    }
    return $names.ToArray()
}

function Test-OpenQuestion {
    # True when the newest close_confirm_asked at or after SinceMs has no close_confirm_answered after it (file order
    # decides). An unanswered question is the owner's to answer, whichever invocation caused it.
    param([string[]]$Lines, [long]$SinceMs)
    $open = $false
    foreach ($line in @($Lines)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $entry = $line | ConvertFrom-Json } catch { continue }
        $props = @($entry.PSObject.Properties.Name)
        if (($props -notcontains 't') -or ($props -notcontains 'event')) { continue }
        $stamp = 0L
        if (-not [long]::TryParse([string]$entry.t, [ref]$stamp)) { continue }
        if ($stamp -lt $SinceMs) { continue }
        if ([string]$entry.event -eq $ConfirmEvent) { $open = $true }
        elseif ([string]$entry.event -eq $ConfirmAnsweredEvent) { $open = $false }
    }
    return $open
}

function Get-EvidenceStart {
    # Where the evidence of this close begins: the request, unless the owner's question was already open at the request.
    # The shell flushes first and asks after, so a close the owner answers after the request has its store_flush
    # before it: the evidence then begins at the newest store_flush of that close (an earlier close ends at its
    # supervise_shutdown, a restart at start), or at the question itself when none was logged.
    param([string[]]$Lines, [long]$SentAt)
    $flushAt = -1L
    $from = -1L
    foreach ($line in @($Lines)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $entry = $line | ConvertFrom-Json } catch { continue }
        $props = @($entry.PSObject.Properties.Name)
        if (($props -notcontains 't') -or ($props -notcontains 'event')) { continue }
        $stamp = 0L
        if (-not [long]::TryParse([string]$entry.t, [ref]$stamp)) { continue }
        if ($stamp -ge $SentAt) { continue }
        switch ([string]$entry.event) {
            'start' { $flushAt = -1L; $from = -1L }
            'supervise_shutdown' { $flushAt = -1L; $from = -1L }
            'store_flush' { $flushAt = $stamp }
            $ConfirmEvent { $from = if ($flushAt -ge 0) { $flushAt } else { $stamp } }
            $ConfirmAnsweredEvent { $from = -1L }
        }
    }
    if ($from -ge 0) { return [math]::Min($SentAt, $from) }
    return $SentAt
}

function Get-MissingEvidence {
    param([string[]]$Events)
    return @($RequiredEvents | Where-Object { @($Events) -notcontains $_ })
}

function Get-ShutdownMode {
    # The "mode" field (spawned, attached or none) of the supervise_shutdown line written at or after SinceMs, or ''.
    param([string[]]$Lines, [long]$SinceMs)
    $mode = ''
    foreach ($line in @($Lines)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $entry = $line | ConvertFrom-Json } catch { continue }
        $props = @($entry.PSObject.Properties.Name)
        if (($props -notcontains 't') -or ($props -notcontains 'event') -or ($props -notcontains 'mode')) { continue }
        $stamp = 0L
        if (-not [long]::TryParse([string]$entry.t, [ref]$stamp)) { continue }
        if (($stamp -ge $SinceMs) -and ([string]$entry.event -eq 'supervise_shutdown')) { $mode = [string]$entry.mode }
    }
    return $mode
}

function Get-OverallCode {
    # The worst result wins: confirm pending, timed out, forced, no evidence, error, then graceful. No result at all is
    # "not running".
    param([object[]]$Results)
    $status = @($Results | ForEach-Object { $_.Status })
    if ($status.Count -eq 0) { return $ExitNotRunning }
    if ($status -contains 'confirm-pending') { return $ExitConfirmPending }
    if (($status -contains 'timeout') -or ($status -contains 'log-unreadable')) { return $ExitTimedOut }
    if ($status -contains 'forced') { return $ExitForced }
    if ($status -contains 'no-evidence') { return $ExitNoEvidence }
    if (($status -contains 'no-window') -or ($status -contains 'post-failed') -or ($status -contains 'skipped')) { return $ExitError }
    return $ExitGraceful
}

# ---- the run, over ports (a real Win32 set below, a mock set in the tests) --------------------------------------------------

function New-Result {
    param([int]$ProcessId, [string]$Status, [string]$Detail)
    return [pscustomobject]@{ ProcessId = $ProcessId; Status = $Status; Detail = $Detail }
}

function Test-CloseInProgress {
    # The shell has flushed its store but not yet logged its shutdown: it is between the flush and the end of the close,
    # where it reads the job count and may ask the owner. Killing it then could cut off a question not yet asked.
    param([string[]]$Events)
    return (@($Events) -contains 'store_flush') -and (@($Events) -notcontains 'supervise_shutdown')
}

function Wait-ForExit {
    # $Process is the object the listing returned; the liveness check never looks a process up by id. Returns true when
    # the process is gone. It returns false at the deadline, and also at once when the log (read about once a second)
    # shows the app's close question at or after SinceMs: the caller then decides from the log whether it is still open.
    param($Ports, $Process, [long]$DeadlineMs, [long]$SinceMs)
    $nextLogMs = 0L
    while (& $Ports.Alive $Process) {
        $now = [long](& $Ports.NowMs)
        if ($now -ge $DeadlineMs) { return $false }
        if ($now -ge $nextLogMs) {
            $nextLogMs = $now + $LogPollMs
            if (Test-OpenQuestion @(& $Ports.LogLines $Ports.LogPath) $SinceMs) { return $false }
        }
        & $Ports.Sleep $WaitPollMs
    }
    return $true
}

function Get-ExitedResult {
    # The shell is gone: graceful only with both log events after the request (the shutdown mode is reported).
    param([int]$ProcessId, [string[]]$Missing, [string]$Mode)
    if ($Missing.Count -gt 0) { return New-Result $ProcessId 'no-evidence' "exited, but the log lacks after the request: $($Missing -join ', ')" }
    $modeText = if ($Mode) { " (mode $Mode)" } else { '' }
    return New-Result $ProcessId 'graceful' "exited; the log shows store_flush and supervise_shutdown$modeText after the request"
}

function Get-LogUnreadableDetail {
    param([int]$Wait, [string]$Path)
    return "still running after $Wait s, and the shell log could not be read ($Path), so an open backtest question cannot be ruled out: nothing was stopped (not even with -Force); check -LogPath"
}

function Invoke-CloseOne {
    param($Ports, $Target, [int]$Timeout, [bool]$ForceStop, [bool]$Dry)
    $ProcessId = [int]$Target.Id
    $window = Select-CloseWindow @(& $Ports.Windows $ProcessId)
    if ($null -eq $window) {
        return New-Result $ProcessId 'no-window' 'no closable window (only helper, untitled or owned windows): nothing was sent'
    }
    $what = "window class '$($window.Class)', title '$($window.Title)'"
    if ($Dry) { return New-Result $ProcessId 'dry-run' "would post WM_CLOSE to $what" }
    $sentAt = [long](& $Ports.NowMs)
    $posted = & $Ports.Post $window.Handle
    if ($posted -ne $true) {
        return New-Result $ProcessId 'post-failed' "the close request could not be posted to ${what}: nothing was waited for or stopped"
    }
    Write-Host "process ${ProcessId}: posted WM_CLOSE to $what"
    # -Force waits at least the flush budget plus the job count read: the shell asks only after both.
    $wait = if ($ForceStop) { [math]::Max($Timeout, $ForceMinTimeoutSeconds) } else { $Timeout }
    if ($wait -ne $Timeout) { Write-Host "process ${ProcessId}: -Force waits at least $wait s (the shell asks about a running backtest only after its flush)" }
    $exited = Wait-ForExit $Ports $Target.Process ($sentAt + 1000L * $wait) $sentAt
    $lines = @(& $Ports.LogLines $Ports.LogPath)
    $logRead = $lines.Count -gt 0
    $since = Get-EvidenceStart $lines $sentAt
    $events = Get-LogEvents $lines $since
    $missing = @(Get-MissingEvidence $events)
    if ($exited -and -not $logRead) { return New-Result $ProcessId 'no-evidence' "exited, but the shell log could not be read, so the flush and shutdown are unconfirmed ($($Ports.LogPath))" }
    if ($exited) { return Get-ExitedResult $ProcessId $missing (Get-ShutdownMode $lines $since) }
    # A log that was not read (missing, or locked) says nothing about an open question: never stop the shell on it.
    if (-not $logRead) { return New-Result $ProcessId 'log-unreadable' (Get-LogUnreadableDetail $wait $Ports.LogPath) }
    if (Test-QuestionPending $Ports $Target $lines $sentAt $ForceStop) {
        return New-Result $ProcessId 'confirm-pending' "still running after $wait s: a backtest is running and the app is asking whether to close; the owner has not answered, so nothing was stopped"
    }
    if (-not $ForceStop) { return New-Result $ProcessId 'timeout' "still running after $wait s; not forced (log lacks: $($missing -join ', '))" }
    if (Test-CloseInProgress $events) {
        # Flushed but not shut down: the job count read and the question may still be on their way. Wait a bounded while.
        Write-Host "process ${ProcessId}: the shell has flushed but not shut down yet; waiting up to $CloseSequenceGraceSeconds s more before any stop"
        [void](Wait-ForExit $Ports $Target.Process ([long](& $Ports.NowMs) + 1000L * $CloseSequenceGraceSeconds) $sentAt)
    }
    # Read the log again right before the stop: the question or the exit may have come while the first read was handled.
    $fresh = @(& $Ports.LogLines $Ports.LogPath)
    if ((-not (& $Ports.Alive $Target.Process)) -and ($fresh.Count -eq 0)) { return New-Result $ProcessId 'no-evidence' "exited, but the shell log could not be read, so the flush and shutdown are unconfirmed ($($Ports.LogPath))" }
    if ($fresh.Count -eq 0) { return New-Result $ProcessId 'log-unreadable' (Get-LogUnreadableDetail $wait $Ports.LogPath) }
    if (-not (& $Ports.Alive $Target.Process)) { return Get-ExitedResult $ProcessId @(Get-MissingEvidence (Get-LogEvents $fresh (Get-EvidenceStart $fresh $sentAt))) (Get-ShutdownMode $fresh (Get-EvidenceStart $fresh $sentAt)) }
    if (Test-QuestionPending $Ports $Target $fresh $sentAt $true) {
        return New-Result $ProcessId 'confirm-pending' "still running after $wait s: a backtest is running and the app is asking whether to close; the owner has not answered, so nothing was stopped"
    }
    & $Ports.Stop $Target.Process
    return New-Result $ProcessId 'forced' "still running after $wait s; the shell process was stopped (log lacked: $($missing -join ', '))"
}

function Test-QuestionPending {
    # An unanswered close question after this request, or (with -Force) any unanswered one since the shell started: a
    # question an earlier invocation left open must not be killed over.
    param($Ports, $Target, [string[]]$Lines, [long]$SentAt, [bool]$ForceStop)
    # A question the owner opened before the request is still open afterwards: the posted close waits behind the modal
    # dialog, so no new close_confirm_asked follows it. Every run therefore looks back to the shell's start.
    if (Test-OpenQuestion $Lines $SentAt) { return $true }
    return (Test-OpenQuestion $Lines ([long](& $Ports.StartMs $Target.Process)))
}

function Invoke-CloseApp {
    # Returns @{ Code; Results }. $Ports: Processes, Owner, Windows, Post, Alive, StartMs, Stop, LogLines, NowMs, Sleep.
    # Processes returns records { Id, Name, Owner, Process }; Alive and Stop take the record's Process object.
    param($Ports, [string]$Image, [int[]]$Wanted, [int]$Timeout, [bool]$ForceStop, [bool]$Dry)
    $listed = @(& $Ports.Processes $Image)
    $mine = @(Select-OwnProcess $listed $Ports.Owner $Image $Wanted)
    $skipped = @(Select-SkippedProcess $listed $Ports.Owner $Image $Wanted)
    $results = @(foreach ($p in $mine) { Invoke-CloseOne $Ports $p $Timeout $ForceStop $Dry })
    $results += @(foreach ($s in $skipped) {
            New-Result ([int]$s.Id) 'skipped' "$($s.Name) was listed but could not be checked ($($s.Reason)); it was not closed, and it may be running"
        })
    return [pscustomobject]@{ Code = (Get-OverallCode $results); Results = $results }
}

# ---- the real ports ----------------------------------------------------------------------------------------------------------

function Initialize-Win32 {
    if ('NqtCloseWin' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public sealed class NqtCloseWindow
{
    public long Handle;
    public long OwnerHandle;
    public int ProcessId;
    public string Class;
    public string Title;
    public bool Visible;
}

public static class NqtCloseWin
{
    private delegate bool EnumProc(IntPtr h, IntPtr l);
    private const uint GW_OWNER = 4;
    private const uint WM_CLOSE = 0x0010;
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

    // Every top-level window of the process, in enumeration order.
    public static NqtCloseWindow[] WindowsOf(int processId)
    {
        List<NqtCloseWindow> found = new List<NqtCloseWindow>();
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid != (uint)processId) return true;
            StringBuilder cls = new StringBuilder(256); GetClassName(h, cls, 256);
            int length = GetWindowTextLength(h);
            StringBuilder title = new StringBuilder(length + 1);
            if (length > 0) GetWindowText(h, title, length + 1);
            NqtCloseWindow w = new NqtCloseWindow();
            w.Handle = h.ToInt64();
            w.OwnerHandle = GetWindow(h, GW_OWNER).ToInt64();
            w.ProcessId = processId;
            w.Class = cls.ToString();
            w.Title = title.ToString();
            w.Visible = IsWindowVisible(h);
            found.Add(w);
            return true;
        }, IntPtr.Zero);
        return found.ToArray();
    }

    // The only message this script ever sends: the close request.
    public static bool Close(long handle) { return PostMessage(new IntPtr(handle), WM_CLOSE, IntPtr.Zero, IntPtr.Zero); }
}
'@
}

function Get-LogTail {
    # The newest bytes of the log, opened for reading with every share flag so the running app's writes are not blocked.
    param([string]$Path)
    # Nothing at all (not an empty list) means "not read": a missing or locked log. A log that was read always yields at
    # least one element, even when it is empty, so the caller can tell the two apart.
    if (-not (Test-Path -LiteralPath $Path)) { return }
    try { $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]'ReadWrite, Delete') } catch [System.IO.IOException], [System.UnauthorizedAccessException] { return }
    try {
        $count = [int][math]::Min($stream.Length, $LogTailBytes)
        [void]$stream.Seek(-$count, [System.IO.SeekOrigin]::End)
        $bytes = New-Object byte[] $count
        $read = 0
        while ($read -lt $count) { $n = $stream.Read($bytes, $read, $count - $read); if ($n -le 0) { break }; $read += $n }
        return ([System.Text.Encoding]::UTF8.GetString($bytes, 0, $read)).Split("`n")
    } finally { $stream.Dispose() }
}

function Test-ProcessGone {
    # GetProcessById throws ArgumentException for an id with no process (PowerShell may wrap it): the process has ended.
    param($ErrorRecord)
    $e = $ErrorRecord.Exception
    while ($null -ne $e) {
        if ($e -is [System.ArgumentException]) { return $true }
        $e = $e.InnerException
    }
    return $false
}

function Get-ProcessRecords {
    # The listing behind the real Processes port. Each vetted record is { Id, Name, Owner, Process, Skipped = $false }:
    # Process is the System.Diagnostics.Process object with its handle opened now (.Handle), so the wait and the stop stay
    # on this very process even if the system reuses its id; the CIM creation time must match the handle's start time,
    # which catches an id reused between the listing and the handle. A process that ended meanwhile is left out. Any other
    # failure (access denied, an unreadable owner or start time, a skew over 2 s, another image name on the handle) never
    # drops the process silently: it comes back as { Skipped = $true, Reason } and the run exits 1, so "not running" (2)
    # only ever means that no such process exists. $OwnerOf takes the CIM row, $Open takes the id.
    param([string]$Image, [object[]]$CimProcesses, [scriptblock]$OwnerOf, [scriptblock]$Open)
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($cim in @($CimProcesses)) {
        $id = [int]$cim.ProcessId
        $skip = {
            param([string]$Reason, [string]$Who)
            [pscustomobject]@{ Id = $id; Name = [string]$cim.Name; Owner = $Who; Process = $null; Skipped = $true; Reason = $Reason }
        }
        $who = ''
        try {
            $owned = & $OwnerOf $cim
            if ($null -ne $owned.User) { $who = "$($owned.Domain)\$($owned.User)" }
        } catch { $who = '' }
        $proc = $null
        try { $proc = & $Open $id } catch {
            if (-not (Test-ProcessGone $_)) { $found.Add((& $skip "cannot open the process: $($_.Exception.Message)" $who)) }
            continue
        }
        try {
            # PowerShell can swallow an exception of a property getter and yield $null, so an empty handle is a failure too.
            $handleValue = $proc.Handle
            if (($null -eq $handleValue) -or ([System.IntPtr]$handleValue -eq [System.IntPtr]::Zero)) { throw 'the handle is empty (access denied?)' }
        } catch {
            $proc.Dispose()
            $found.Add((& $skip "cannot open a handle: $($_.Exception.Message)" $who))
            continue
        }
        try {
            $skew = [math]::Abs(($proc.StartTime.ToUniversalTime() - ([datetime]$cim.CreationDate).ToUniversalTime()).TotalSeconds)
            $procName = [string]$proc.ProcessName
        } catch {
            $proc.Dispose()
            $found.Add((& $skip "cannot read the start time or image name: $($_.Exception.Message)" $who))
            continue
        }
        if ($skew -gt 2) {
            $proc.Dispose()
            $found.Add((& $skip ("start time differs from the system's creation time by {0:N1} s (id reused or clock skew)" -f $skew) $who))
            continue
        }
        if ($procName -ine $Image) {
            $proc.Dispose()
            $found.Add((& $skip "image name '$procName' on the handle differs from '$Image'" $who))
            continue
        }
        if ([string]::IsNullOrEmpty($who)) {
            $proc.Dispose()
            $found.Add((& $skip 'the owner could not be read' ''))
            continue
        }
        $found.Add([pscustomobject]@{ Id = $id; Name = [string]$cim.Name; Owner = $who; Process = $proc; Skipped = $false; Reason = '' })
    }
    return $found.ToArray()
}

function New-Win32Ports {
    param([string]$Log)
    Initialize-Win32
    $owner = "$([Environment]::UserDomainName)\$([Environment]::UserName)"
    return [pscustomobject]@{
        Owner    = $owner
        Processes = {
            param($Image)
            if ($Image -notmatch '^[A-Za-z0-9._ -]+$') { throw "bad image name '$Image'" }
            Get-ProcessRecords $Image @(Get-CimInstance Win32_Process -Filter "Name = '$Image.exe'") `
                { param($Cim) Invoke-CimMethod -InputObject $Cim -MethodName GetOwner } `
                { param($Id) [System.Diagnostics.Process]::GetProcessById($Id) }
        }
        Windows  = { param($ProcessId) @([NqtCloseWin]::WindowsOf($ProcessId)) }
        Post     = { param($Handle) [bool][NqtCloseWin]::Close([long]$Handle) }
        Alive    = { param($Process) -not $Process.HasExited }
        StartMs  = { param($Process) [DateTimeOffset]::new($Process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() }
        Stop     = { param($Process) try { $Process.Kill() } catch { if (-not $Process.HasExited) { throw } } }
        LogPath  = $Log
        LogLines = { param($Path) Get-LogTail $Path }
        NowMs    = { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
        Sleep    = { param($Ms) Start-Sleep -Milliseconds $Ms }
    }
}

if ($LibraryOnly) { return }

# ---- main --------------------------------------------------------------------------------------------------------------------

if ($TimeoutSeconds -lt 1) { Write-Host 'ERROR  -TimeoutSeconds must be at least 1'; exit $ExitError }
if (-not (Test-ImageNameAllowed $ImageName)) {
    Write-Host "ERROR  -ImageName must be '$AppImageName' (or a test stand-in named nqt-test-<letters, digits, hyphens>); nothing was listed or sent"
    exit $ExitError
}
if (-not $LogPath) { $LogPath = Join-Path $env:APPDATA "$DefaultIdentifier\logs\shell.log" }
$ports = New-Win32Ports $LogPath
$run = Invoke-CloseApp $ports $ImageName $ProcessId $TimeoutSeconds $Force.IsPresent $DryRun.IsPresent
if (@($run.Results).Count -eq 0) { Write-Host "NOT RUNNING  no $ImageName.exe process of this user$(if (@($ProcessId).Count -gt 0) { ' among the given -ProcessId values' })" }
foreach ($r in $run.Results) { Write-Host ("{0,-11} process {1}: {2}" -f $r.Status.ToUpperInvariant(), $r.ProcessId, $r.Detail) }
exit $run.Code
