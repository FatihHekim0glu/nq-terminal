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
       supervise_shutdown written after the request. Both present and the process gone is graceful.
    4. On a timeout without -Force it reports and exits 3 and never kills. With -Force it stops the shell process
       only (the backend ends through the job object and the closed stdin, as seen on 7 October 2026) and reports
       'forced' (exit 4).
  -DryRun lists the processes and prints which window it would close; it posts nothing and waits for nothing.
  The output holds process ids, window classes and titles and the names of log events. It prints no environment value.

  Exit codes:
    0  graceful: the shell exited and its log shows store_flush and supervise_shutdown after the request
        (with -DryRun: a window was found and nothing was sent)
    1  error: bad arguments, or a running shell with no closable window (nothing was sent)
    2  not running: no nq-lab-terminal.exe process of this user (or none of the given -ProcessId values)
    3  timed out: the shell was still running after -TimeoutSeconds and -Force was not given
    4  forced: the shell did not exit in time and was stopped with -Force
    5  exited without evidence: the shell exited but the log lacks store_flush or supervise_shutdown after the request
  With several shells the worst result decides: 3, then 4, then 5, then 1, then 0.
.PARAMETER ProcessId
  Only these process ids (still restricted to the image name and to this user).
.PARAMETER TimeoutSeconds
  How long to wait for the shell to exit after the request. Default 30.
.PARAMETER Force
  On a timeout, stop the shell process (never its children, never another program).
.PARAMETER DryRun
  Print which window would be closed and send nothing.
.PARAMETER LogPath
  The shell log to read. Default %APPDATA%\dev.nqlab.terminal\logs\shell.log. Test hook.
.PARAMETER ImageName
  The image name to look for, without .exe. Default nq-lab-terminal. Test hook (tests\close-app.tests.ps1 closes a
  stand-in process that has a window and nothing else).
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

# ---- pure rules (tested without windows or processes) -------------------------------------------------------------------

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

function Select-OwnProcess {
    # The processes this run may touch: the image name, this user, and (when given) one of the wanted ids.
    param([object[]]$Processes, [string]$Owner, [string]$Image, [int[]]$Wanted)
    return @($Processes | Where-Object {
            ($_.Name -ieq "$Image.exe") -and ($_.Owner -ieq $Owner) -and ((@($Wanted).Count -eq 0) -or (@($Wanted) -contains $_.Id))
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

function Get-MissingEvidence {
    param([string[]]$Events)
    return @($RequiredEvents | Where-Object { @($Events) -notcontains $_ })
}

function Get-OverallCode {
    # The worst result wins: timed out, forced, no evidence, error, then graceful. No result at all is "not running".
    param([object[]]$Results)
    $status = @($Results | ForEach-Object { $_.Status })
    if ($status.Count -eq 0) { return $ExitNotRunning }
    if ($status -contains 'timeout') { return $ExitTimedOut }
    if ($status -contains 'forced') { return $ExitForced }
    if ($status -contains 'no-evidence') { return $ExitNoEvidence }
    if ($status -contains 'no-window') { return $ExitError }
    return $ExitGraceful
}

# ---- the run, over ports (a real Win32 set below, a mock set in the tests) --------------------------------------------------

function New-Result {
    param([int]$ProcessId, [string]$Status, [string]$Detail)
    return [pscustomobject]@{ ProcessId = $ProcessId; Status = $Status; Detail = $Detail }
}

function Wait-ForExit {
    param($Ports, [int]$ProcessId, [long]$DeadlineMs)
    while (& $Ports.Alive $ProcessId) {
        if ((& $Ports.NowMs) -ge $DeadlineMs) { return $false }
        & $Ports.Sleep $WaitPollMs
    }
    return $true
}

function Invoke-CloseOne {
    param($Ports, [int]$ProcessId, [int]$Timeout, [bool]$ForceStop, [bool]$Dry)
    $window = Select-CloseWindow @(& $Ports.Windows $ProcessId)
    if ($null -eq $window) {
        return New-Result $ProcessId 'no-window' 'no closable window (only helper, untitled or owned windows): nothing was sent'
    }
    $what = "window class '$($window.Class)', title '$($window.Title)'"
    if ($Dry) { return New-Result $ProcessId 'dry-run' "would post WM_CLOSE to $what" }
    $sentAt = [long](& $Ports.NowMs)
    & $Ports.Post $window.Handle
    Write-Host "process ${ProcessId}: posted WM_CLOSE to $what"
    $exited = Wait-ForExit $Ports $ProcessId ($sentAt + 1000L * $Timeout)
    $events = Get-LogEvents @(& $Ports.LogLines $Ports.LogPath) $sentAt
    $missing = @(Get-MissingEvidence $events)
    if ($exited) {
        if ($missing.Count -eq 0) { return New-Result $ProcessId 'graceful' 'exited; the log shows store_flush and supervise_shutdown after the request' }
        return New-Result $ProcessId 'no-evidence' "exited, but the log lacks after the request: $($missing -join ', ')"
    }
    if (-not $ForceStop) { return New-Result $ProcessId 'timeout' "still running after $Timeout s; not forced (log lacks: $($missing -join ', '))" }
    & $Ports.Stop $ProcessId
    return New-Result $ProcessId 'forced' "still running after $Timeout s; the shell process was stopped (log lacked: $($missing -join ', '))"
}

function Invoke-CloseApp {
    # Returns @{ Code; Results }. $Ports: Processes, Owner, Windows, Post, Alive, Stop, LogLines, NowMs, Sleep.
    param($Ports, [string]$Image, [int[]]$Wanted, [int]$Timeout, [bool]$ForceStop, [bool]$Dry)
    $mine = @(Select-OwnProcess @(& $Ports.Processes $Image) $Ports.Owner $Image $Wanted)
    $results = @(foreach ($p in $mine) { Invoke-CloseOne $Ports $p.Id $Timeout $ForceStop $Dry })
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
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]'ReadWrite, Delete')
    try {
        $count = [int][math]::Min($stream.Length, $LogTailBytes)
        [void]$stream.Seek(-$count, [System.IO.SeekOrigin]::End)
        $bytes = New-Object byte[] $count
        $read = 0
        while ($read -lt $count) { $n = $stream.Read($bytes, $read, $count - $read); if ($n -le 0) { break }; $read += $n }
        return ([System.Text.Encoding]::UTF8.GetString($bytes, 0, $read)).Split("`n")
    } finally { $stream.Dispose() }
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
            @(Get-CimInstance Win32_Process -Filter "Name = '$Image.exe'" | ForEach-Object {
                    $who = Invoke-CimMethod -InputObject $_ -MethodName GetOwner
                    $name = if ($null -ne $who.User) { "$($who.Domain)\$($who.User)" } else { '' }
                    [pscustomobject]@{ Id = [int]$_.ProcessId; Name = [string]$_.Name; Owner = $name }
                })
        }
        Windows  = { param($ProcessId) @([NqtCloseWin]::WindowsOf($ProcessId)) }
        Post     = { param($Handle) [void][NqtCloseWin]::Close([long]$Handle) }
        Alive    = { param($ProcessId) $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) }
        Stop     = { param($ProcessId) Stop-Process -Id $ProcessId -Force }
        LogPath  = $Log
        LogLines = { param($Path) Get-LogTail $Path }
        NowMs    = { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
        Sleep    = { param($Ms) Start-Sleep -Milliseconds $Ms }
    }
}

if ($LibraryOnly) { return }

# ---- main --------------------------------------------------------------------------------------------------------------------

if ($TimeoutSeconds -lt 1) { Write-Host 'ERROR  -TimeoutSeconds must be at least 1'; exit $ExitError }
if ($ImageName -notmatch '^[A-Za-z0-9._ -]+$') { Write-Host 'ERROR  -ImageName holds characters a process name cannot'; exit $ExitError }
if (-not $LogPath) { $LogPath = Join-Path $env:APPDATA "$DefaultIdentifier\logs\shell.log" }
$ports = New-Win32Ports $LogPath
$run = Invoke-CloseApp $ports $ImageName $ProcessId $TimeoutSeconds $Force.IsPresent $DryRun.IsPresent
if (@($run.Results).Count -eq 0) { Write-Host "NOT RUNNING  no $ImageName.exe process of this user$(if (@($ProcessId).Count -gt 0) { ' among the given -ProcessId values' })" }
foreach ($r in $run.Results) { Write-Host ("{0,-11} process {1}: {2}" -f $r.Status.ToUpperInvariant(), $r.ProcessId, $r.Detail) }
exit $run.Code
