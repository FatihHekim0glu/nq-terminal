<#
.SYNOPSIS
  Real-data smoke run of the nq-lab terminal (read only), TASKS 8.3.

.DESCRIPTION
  From the nq-lab folder:
    powershell -NoProfile -ExecutionPolicy Bypass -File terminal\scripts\smoke_real.ps1

  1. Runs its own self-test first: the log and file checks below, and the coverage check, must fail on broken
     input. Then the coverage check reads the smoke spec: it must open VCONE, SEAS, EVT, ROLL and DQ, ask each
     for its [POST HOC] label, and scan the market, seasonality, events and DQ answers for dates past the fence.
  2. Records the sha256 of results\ledger.csv, results\registry.csv and results\oos_openings.json, and the
     length and sha256 of results\oos_access_log.jsonl.
  3. Builds the web app into a temporary folder (web\dist and web\dist-gallery are not touched).
  4. Starts a second backend with the venv Python (uvicorn, nq_terminal.app:create_app) on
     127.0.0.1:ApiPort against the real data root (NQT_FIXTURE_DIR removed), and vite preview of that
     build on 127.0.0.1:WebPort with /api proxied to it. The user's own backend on 8765 is never used.
     The backend has a state folder of its own (so its own lock and token, and it never meets the user's
     backend; it sits inside the work folder and is removed once the servers have stopped), NQT_JOBS=off
     (it can run neither a backtest nor the IB snapshot, whatever the caller's shell sets) and only the allow-listed
     environment of desktop\envlist.py, built by the venv Python: no API key of this shell reaches it.
  5. Reads the token from that lock after the backend proved it holds it (a fresh nonce), mints a one-time
     launch code and hands the session page address http://127.0.0.1:WebPort/session.html#<code> to
     Playwright, whose global set-up redeems it on the preview origin in a headless browser and keeps the
     cookie. Then runs web\e2e\perf\real.config.ts: the trace arithmetic checks, then smoke.real.ts (every
     screen on real files, and the performance budgets measured on real data with a CDP trace). Without the
     cookie every /api call is refused (401).
  6. Stops both servers, then checks that every new log line has caller "terminal" and a window inside
     [2010-01-01, 2022-01-01), that the log's earlier bytes are unchanged (append only), and that the
     three research files are unchanged.

  Writes smoke_summary.json and the server logs to a temporary folder and prints the summary. The exit
  code is 0 only when every check passes. Nothing is written under results, backtests\output, data or
  live; the gate's own log lines for the terminal's reads are the one expected change.

.PARAMETER ApiPort
  Port of the second backend on 127.0.0.1 (default 8953). Never 8765.
.PARAMETER WebPort
  Port of vite preview on 127.0.0.1 (default 4953). Never 8765.
.PARAMETER Grep
  Only run the smoke tests whose title matches this pattern (Playwright --grep).
.PARAMETER SelfTest
  Run only the self-test of the checks, on files in a temporary folder, and the coverage check of the smoke
  spec, and start nothing.
.PARAMETER Mode
  Browser (default): the run described above, a headless browser against a second backend and a vite preview. App: the same
  checks around a run of the hidden smoke build of the Windows app (04 D5.2): the app starts the real backend itself over this
  lab (no --fixture) with a temporary --state-dir, --webview-data-dir and --config-dir under D:\dev\d5\smoke-app and
  NQT_JOBS=off, under the global window watch and with a PATH without the build tools; Playwright attaches to its page over the
  debugging protocol (playwright.desktop.config.ts with NQT_DESKTOP_MODE=real, spec web\e2e\desktop\smoke.app.ts). No vite
  build, no preview, no ApiPort or WebPort. web\dist must already be built (the smoke build refuses rebuilds). The shell's own
  log must show a real, own-folders launch (Test-AppLaunchRecord). The performance budgets are not measured in either mode here.
  App mode refuses to start outside the lab's own terminal folder (a worktree): the backend confines its reads to the real
  paths under the lab. Browser mode runs in a worktree; the lab is then NQT_REAL_LAB, or nq-lab under the profile folder.
.PARAMETER SmokeExe
  App mode: the smoke build (default NQT_SMOKE_EXE, then D:\dev\targets\w5a-app-smoke\release\nq-lab-terminal.exe).
.PARAMETER SmokeSpec
  The smoke spec the coverage check reads (default web\e2e\perf\smoke.real.ts). Only the check reads it;
  Playwright always runs the spec named in real.config.ts.
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$ApiPort = 8953,
    [ValidateRange(1024, 65535)]
    [int]$WebPort = 4953,
    [string]$Grep = '',
    [switch]$SelfTest,
    [string]$SmokeSpec = '',
    [ValidateSet('Browser', 'App')]
    [string]$Mode = 'Browser',
    [string]$SmokeExe = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Terminal = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Terminal 'backend'
$Web = Join-Path $Terminal 'web'
$ViteScript = Join-Path $Web 'node_modules\vite\bin\vite.js'
$PlaywrightScript = Join-Path $Web 'node_modules\@playwright\test\cli.js'
$Loopback = '127.0.0.1'
$UserPort = 8765
$StartupSeconds = 120
$PinnedFiles = @('ledger.csv', 'registry.csv', 'oos_openings.json')
$LogName = 'oos_access_log.jsonl'
$ExpectedCaller = 'terminal'
$IsStart = [DateTimeOffset]::new(2010, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
$IsEnd = [DateTimeOffset]::new(2022, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$P11Codes = @('VCONE', 'SEAS', 'EVT', 'ROLL', 'DQ')
$P11FencedPrefixes = @('/api/market/', '/api/seasonality/', '/api/events/', '/api/dq/')
$AppRoot = 'D:\dev\d5\smoke-app'
$DefaultSmokeExe = 'D:\dev\targets\w5a-app-smoke\release\nq-lab-terminal.exe'
if ($SmokeSpec -eq '') { $SmokeSpec = if ($Mode -eq 'App') { Join-Path $Web 'e2e\desktop\smoke.app.ts' } else { Join-Path $Web 'e2e\perf\smoke.real.ts' } }

function Stop-Smoke([string]$Message) {
    [Console]::Error.WriteLine("smoke_real.ps1: $Message")
    exit 1
}

# A lab holds the venv interpreter and the research package's config (what the shell's own lab check asks first).
function Test-IsLab([string]$Folder) {
    return (Test-Path -LiteralPath (Join-Path $Folder '.venv\Scripts\python.exe') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Folder 'src\nq_lab\config.py') -PathType Leaf)
}

# The lab whose research files this run guards. The folder above the terminal folder when that is a lab (the terminal is the
# lab's own); otherwise (a worktree of the terminal outside the lab) the lab named by NQT_REAL_LAB, then nq-lab under the
# profile folder. Null when there is none: a run with no research files to guard does not start.
function Resolve-LabRoot([string]$TerminalDir, [string]$NamedLab, [string]$ProfileDir) {
    $parent = Split-Path -Parent $TerminalDir
    if (Test-IsLab $parent) { return $parent }
    if ($NamedLab -ne '') { if (Test-IsLab $NamedLab) { return $NamedLab } else { return $null } }
    if ($ProfileDir -ne '') {
        $fallback = Join-Path $ProfileDir 'nq-lab'
        if (Test-IsLab $fallback) { return $fallback }
    }
    return $null
}

$Root = Resolve-LabRoot $Terminal ([Environment]::GetEnvironmentVariable('NQT_REAL_LAB', 'Process')) ([Environment]::GetFolderPath('UserProfile'))
if ($null -eq $Root -and -not $SelfTest) { Stop-Smoke 'no nq-lab folder: this terminal is not inside one, NQT_REAL_LAB names none and there is no nq-lab under the profile folder.' }
if ($null -eq $Root) { $Root = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'nq-lab' }
$InLab = (Split-Path -Parent $Terminal) -eq $Root
$Results = Join-Path $Root 'results'
$Python = Join-Path $Root '.venv\Scripts\python.exe'

# ---------------------------------------------------------------- checks (pure, self-tested)

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Open-ReadShared([string]$Path) {
    # Read only, and let the gate keep appending while the file is open.
    return [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
}

function Get-PrefixSha256([string]$Path, [long]$Length) {
    $stream = Open-ReadShared $Path
    try {
        if ($stream.Length -lt $Length) { return 'shorter than before' }
        $buffer = New-Object byte[] $Length
        $read = 0
        while ($read -lt $Length) {
            $n = $stream.Read($buffer, $read, [int]($Length - $read))
            if ($n -le 0) { break }
            $read += $n
        }
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($sha.ComputeHash($buffer, 0, $read)) -replace '-', '').ToLowerInvariant() }
        finally { $sha.Dispose() }
    } finally {
        $stream.Dispose()
    }
}

function Get-Snapshot([string]$ResultsDir) {
    $files = [ordered]@{}
    foreach ($name in $PinnedFiles) {
        $path = Join-Path $ResultsDir $name
        $files[$name] = if (Test-Path -LiteralPath $path) { Get-Sha256 $path } else { 'missing' }
    }
    $log = Join-Path $ResultsDir $LogName
    $length = (Get-Item -LiteralPath $log).Length
    return [pscustomobject]@{ files = $files; log_length = $length; log_prefix_sha256 = (Get-PrefixSha256 $log $length) }
}

function Read-NewLogText([string]$Path, [long]$Offset) {
    $stream = Open-ReadShared $Path
    try {
        if ($stream.Length -lt $Offset) { return $null }
        [void]$stream.Seek($Offset, [System.IO.SeekOrigin]::Begin)
        $reader = New-Object System.IO.StreamReader($stream, $Utf8)
        return $reader.ReadToEnd()
    } finally {
        $stream.Dispose()
    }
}

function ConvertTo-Window([object]$Value) {
    if ($null -eq $Value) { return $null }
    $parsed = [DateTimeOffset]::MinValue
    $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal
    if ([DateTimeOffset]::TryParse([string]$Value, [System.Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$parsed)) { return $parsed }
    return $null
}

function Test-LogLine([string]$Line) {
    try { $entry = $Line | ConvertFrom-Json } catch { return "not JSON: $Line" }
    $entryCaller = if ($entry.PSObject.Properties['caller']) { $entry.caller } else { $null }
    if ($entryCaller -cne $ExpectedCaller) { return "caller is '$entryCaller', not '$ExpectedCaller': $Line" }
    $start = if ($entry.PSObject.Properties['start']) { ConvertTo-Window $entry.start } else { $null }
    $end = if ($entry.PSObject.Properties['end']) { ConvertTo-Window $entry.end } else { $null }
    if ($null -eq $end) { return "no readable end: $Line" }
    if ($end -gt $IsEnd) { return "window ends after 2022-01-01: $Line" }
    if ($null -eq $start -or $start -lt $IsStart) { return "window starts before 2010-01-01 or has no start: $Line" }
    return $null
}

function Test-OtherWorkflowLine([string]$Line) {
    # A research workflow that serves while the smoke runs appends its own lines. A line with another caller whose
    # reason is not one of the terminal's (they all begin 'terminal', bars.serve_reason) is that workflow's read: it is
    # counted, never checked as the terminal's. A line naming no caller, or the terminal's reason under another caller,
    # is still a problem.
    try { $entry = $Line | ConvertFrom-Json } catch { return $false }
    $entryCaller = if ($entry.PSObject.Properties['caller']) { [string]$entry.caller } else { '' }
    $reason = if ($entry.PSObject.Properties['reason']) { [string]$entry.reason } else { '' }
    if ($entryCaller -eq '' -or $entryCaller -ceq $ExpectedCaller) { return $false }
    return -not $reason.StartsWith($ExpectedCaller, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-Log([string]$ResultsDir, [object]$Before) {
    $path = Join-Path $ResultsDir $LogName
    $problems = New-Object System.Collections.Generic.List[string]
    $prefix = Get-PrefixSha256 $path $Before.log_length
    if ($prefix -ne $Before.log_prefix_sha256) { $problems.Add("the log's earlier bytes changed ($prefix): it is no longer append only") }
    $text = Read-NewLogText $path $Before.log_length
    $lines = @()
    if ($null -ne $text) { $lines = @($text -split "`n" | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_ -ne '' }) }
    $entries = New-Object System.Collections.Generic.List[object]
    $others = 0
    foreach ($line in $lines) {
        if (Test-OtherWorkflowLine $line) { $others++; continue }
        $problem = Test-LogLine $line
        if ($null -ne $problem) { $problems.Add($problem); continue }
        $e = $line | ConvertFrom-Json
        $entries.Add([pscustomobject]@{ symbol = "$($e.symbol)"; timeframe = "$($e.timeframe)"; variant = "$($e.variant)"; start = "$($e.start)"; end = "$($e.end)" })
    }
    return [pscustomobject]@{ new_lines = $lines.Count; other_workflow_lines = $others; entries = $entries; problems = $problems }
}

function Compare-Files([object]$Before, [object]$After) {
    $problems = New-Object System.Collections.Generic.List[string]
    foreach ($name in $PinnedFiles) {
        if ($Before.files[$name] -ne $After.files[$name]) { $problems.Add("$name changed: $($Before.files[$name]) then $($After.files[$name])") }
    }
    return $problems
}

function Get-QuotedList([string]$Text, [string]$Name) {
    # The single-quoted strings of `const <Name> = [ ... ]` in the smoke spec, or $null when it has no such list.
    $found = [regex]::Match($Text, "const\s+$Name\s*=\s*\[([^\]]*)\]")
    if (-not $found.Success) { return $null }
    return @([regex]::Matches($found.Groups[1].Value, "'([^']*)'") | ForEach-Object { $_.Groups[1].Value })
}

function Test-SmokeCoverage([string]$Text) {
    # The smoke spec must open every Phase 11 screen, ask each for its [POST HOC] label, and scan the Phase 11
    # answers for dates past the fence. Read from the spec's text, so it runs with no server and no browser.
    $problems = New-Object System.Collections.Generic.List[string]
    $lines = Get-QuotedList $Text 'P11_LINES'
    if ($null -eq $lines) {
        $problems.Add('the smoke spec has no P11_LINES list: no Phase 11 screen is opened')
    } else {
        foreach ($code in $P11Codes) {
            $opened = @($lines | Where-Object { ($_ -split ' ')[-1] -ceq $code })
            if ($opened.Count -eq 0) { $problems.Add("the smoke spec never opens $code") }
        }
        if ($Text -notmatch "for \(const (\w+) of P11_LINES\)[\s\S]{0,300}?openScreen\(page, \1, '\[POST HOC\]'\)") {
            $problems.Add("the smoke spec does not open each P11_LINES entry with openScreen(page, line, '[POST HOC]')")
        }
    }
    $fenced = Get-QuotedList $Text 'FENCED_PREFIXES'
    foreach ($prefix in $P11FencedPrefixes) {
        if ($null -eq $fenced -or $fenced -notcontains $prefix) { $problems.Add("the fence scan skips $prefix answers") }
    }
    if ($Text -match '\btest(\.describe)?\.(skip|fixme|only)\(') { $problems.Add('the smoke spec skips, parks or isolates a test') }
    return $problems
}

# ---------------------------------------------------------------- the backend's own state folder

# A smoke run gives its backend a state folder of its own inside the run's work folder (its result cache, jobs file, lock and
# token), so it never reads or writes the owner's terminal\state, and turns the job queue off whatever the caller's shell says.
# Returns the folder; NQT_STATE_DIR and NQT_JOBS are set for this process (the main flow restores the caller's values).
function New-SmokeState([string]$WorkFolder) {
    $state = Join-Path $WorkFolder 'state'
    New-Item -ItemType Directory -Force -Path $state | Out-Null
    $env:NQT_STATE_DIR = $state
    $env:NQT_JOBS = 'off'
    return $state
}

# Removes that folder after the servers have stopped. It removes only the folder named 'state' directly inside a work folder of
# a smoke run (nqt-smoke-*), never a link and never any other folder, so a wrong argument cannot reach the owner's state.
# True when the folder is gone, false when it was refused or could not be removed.
function Remove-SmokeState([string]$WorkFolder, [string]$State) {
    if ([string]::IsNullOrEmpty($WorkFolder) -or [string]::IsNullOrEmpty($State)) { return $false }
    if ((Split-Path -Leaf $WorkFolder) -notlike 'nqt-smoke-*') { return $false }
    $expected = [System.IO.Path]::GetFullPath((Join-Path $WorkFolder 'state'))
    if (-not [string]::Equals([System.IO.Path]::GetFullPath($State), $expected, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    if (-not (Test-Path -LiteralPath $expected)) { return $true }
    if ((Get-Item -LiteralPath $expected -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { return $false }
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try { Remove-Item -LiteralPath $expected -Recurse -Force -ErrorAction Stop; return $true } catch { Start-Sleep -Milliseconds 400 }
    }
    return -not (Test-Path -LiteralPath $expected)
}

# ---------------------------------------------------------------- self-test (born failing)

function Invoke-StateSelfTest {
    $failures = New-Object System.Collections.Generic.List[string]
    $base = Join-Path ([System.IO.Path]::GetTempPath()) ('nqt-selftest-' +[guid]::NewGuid().ToString('N').Substring(0, 8))
    $work = Join-Path $base 'nqt-smoke-20260101-000000'
    $savedState = $env:NQT_STATE_DIR
    $savedJobs = $env:NQT_JOBS
    $check = {
        param([string]$Name, [bool]$Passed)
        Write-Host ("self-test {0} {1}" -f $(if ($Passed) { 'ok  ' } else { 'FAIL' }), $Name)
        if (-not $Passed) { $failures.Add($Name) }
    }
    try {
        New-Item -ItemType Directory -Force -Path $work | Out-Null
        $env:NQT_STATE_DIR = Join-Path $base 'callers-own-state'
        $env:NQT_JOBS = 'on'
        $state = New-SmokeState $work
        & $check 'the smoke state folder is made inside the work folder and named by NQT_STATE_DIR, not the caller state' ((Test-Path -LiteralPath $state -PathType Container) -and ($env:NQT_STATE_DIR -eq $state) -and ($state -eq (Join-Path $work 'state')))
        & $check 'the job queue is off whatever the caller set' ($env:NQT_JOBS -eq 'off')
        [System.IO.File]::WriteAllText((Join-Path $state 'jobs.json'), "{}`n", $Utf8)
        New-Item -ItemType Directory -Force -Path (Join-Path $state 'logs') | Out-Null
        $outside = Join-Path $base 'terminal-state'
        New-Item -ItemType Directory -Force -Path $outside | Out-Null
        & $check 'a folder that is not the run own state is refused and left in place' ((-not (Remove-SmokeState $work $outside)) -and (Test-Path -LiteralPath $outside))
        & $check 'a work folder that is not a smoke work folder is refused and its state left in place' ((-not (Remove-SmokeState $base (Join-Path $base 'state'))) -and (Test-Path -LiteralPath $state))
        & $check 'no argument is refused' ((-not (Remove-SmokeState '' '')) -and (Test-Path -LiteralPath $state))
        $removed = Remove-SmokeState $work $state
        & $check 'the smoke state folder is removed afterwards with what the backend wrote in it, the work folder stays' ($removed -and (-not (Test-Path -LiteralPath $state)) -and (Test-Path -LiteralPath $work))
        & $check 'removing it again is a no-op that reports it gone' (Remove-SmokeState $work $state)
    } finally {
        $env:NQT_STATE_DIR = $savedState
        $env:NQT_JOBS = $savedJobs
        if (Test-Path -LiteralPath $base) { Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue }
    }
    return $failures
}

function Invoke-SelfTest {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("nqt-smoke-selftest-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $failures = New-Object System.Collections.Generic.List[string]
    $good = '{"ts_utc": "2026-09-27T08:00:00+00:00", "caller": "terminal", "reason": "terminal display", "start": "2010-01-01 00:00:00+00:00", "end": "2022-01-01 00:00:00+00:00", "rows": 3, "symbol": "NQ.V.0", "timeframe": "1d", "variant": "vendor"}'
    $other = '{"ts_utc": "2026-10-03T19:21:02+00:00", "caller": "eomtsy_v1_confirm_is", "reason": "selfcheck of the sealed fetch against the in-sample file", "start": "2021-10-01 00:00:00+00:00", "end": "2022-01-01 00:00:00+00:00", "rows": 65, "symbol": "ZF.V.0", "timeframe": "1d", "variant": "vendor"}'
    $cases = @(
        @{ name = 'terminal lines inside the window pass'; append = @($good); edit = $null; fail = $false },
        @{ name = 'another caller with the terminal''s reason fails'; append = @($good.Replace('"caller": "terminal"', '"caller": "za_screen"')); edit = $null; fail = $true },
        @{ name = 'a line with no caller fails'; append = @($good.Replace('"caller": "terminal", ', '')); edit = $null; fail = $true },
        @{ name = 'a research workflow''s own line (its caller and reason) is counted, not a problem'; append = @($good, $other); edit = $null; fail = $false },
        @{ name = 'a window ending after 2022-01-01 fails'; append = @($good.Replace('"end": "2022-01-01 00:00:00+00:00"', '"end": "2022-01-02 00:00:00+00:00"')); edit = $null; fail = $true },
        @{ name = 'a window starting before 2010 fails'; append = @($good.Replace('"start": "2010-01-01', '"start": "2009-12-31')); edit = $null; fail = $true },
        @{ name = 'a line with no end fails'; append = @($good.Replace('"end"', '"stop"')); edit = $null; fail = $true },
        @{ name = 'a line that is not JSON fails'; append = @('{"caller": "terminal", '); edit = $null; fail = $true },
        @{ name = 'a changed ledger fails'; append = @($good); edit = 'ledger'; fail = $true },
        @{ name = 'a rewritten earlier log line fails'; append = @($good); edit = 'log'; fail = $true }
    )
    try {
        foreach ($case in $cases) {
            $caseDir = Join-Path $dir ([guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $caseDir | Out-Null
            foreach ($name in $PinnedFiles) { [System.IO.File]::WriteAllText((Join-Path $caseDir $name), "fixture $name`n", $Utf8) }
            $log = Join-Path $caseDir $LogName
            [System.IO.File]::WriteAllText($log, '{"caller": "za_screen", "start": "2010-01-01", "end": "2022-01-01"}' + "`n", $Utf8)
            $before = Get-Snapshot $caseDir
            [System.IO.File]::AppendAllText($log, (($case.append -join "`n") + "`n"), $Utf8)
            if ($case.edit -eq 'ledger') { [System.IO.File]::AppendAllText((Join-Path $caseDir 'ledger.csv'), "x`n", $Utf8) }
            if ($case.edit -eq 'log') {
                $bytes = [System.IO.File]::ReadAllBytes($log)
                $bytes[3] = [byte][char]'X'
                [System.IO.File]::WriteAllBytes($log, $bytes)
            }
            $check = Test-Log $caseDir $before
            $problems = @($check.problems) + @(Compare-Files $before (Get-Snapshot $caseDir))
            $failed = $problems.Count -gt 0
            $mark = if ($failed -eq $case.fail) { 'ok  ' } else { 'FAIL' }
            Write-Host ("self-test {0} {1}" -f $mark, $case.name)
            if ($failed -ne $case.fail) { $failures.Add("$($case.name): problems [$($problems -join '; ')]") }
        }
    } finally {
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
    foreach ($failure in (Invoke-CoverageSelfTest)) { $failures.Add($failure) }
    return $failures
}

function Invoke-CoverageSelfTest {
    $failures = New-Object System.Collections.Generic.List[string]
    $good = @(
        "const FENCED_PREFIXES = ['/api/market/', '/api/seasonality/', '/api/events/', '/api/dq/']",
        "const P11_LINES = ['NQ VCONE', 'NQ SEAS', 'volmanaged_v0 SEAS', 'NQ EVT', 'NQ ROLL', 'NQ DQ', 'HO DQ']",
        "test('every Phase 11 screen opens', async ({ page }) => {",
        "  for (const line of P11_LINES) {",
        "    problems.push(...(await openScreen(page, line, '[POST HOC]')))",
        "  }",
        "})"
    ) -join "`n"
    $cases = @(
        @{ name = 'a spec opening every Phase 11 screen passes'; text = $good; fail = $false },
        @{ name = 'a spec with no Phase 11 list fails'; text = $good.Replace('P11_LINES', 'P0_LINES'); fail = $true },
        @{ name = 'a spec that never opens VCONE fails'; text = $good.Replace("'NQ VCONE', ", ''); fail = $true },
        @{ name = 'a spec that never opens ROLL fails'; text = $good.Replace("'NQ ROLL', ", ''); fail = $true },
        @{ name = 'a lower-case code does not count'; text = $good.Replace("'NQ DQ', 'HO DQ'", "'NQ dq'"); fail = $true },
        @{ name = 'a spec that lists the lines but never opens them fails'; text = $good.Replace('for (const line of P11_LINES)', 'for (const line of [])'); fail = $true },
        @{ name = 'a spec that does not ask for [POST HOC] fails'; text = $good.Replace(", '[POST HOC]'", ''); fail = $true },
        @{ name = 'a fence scan without the DQ answers fails'; text = $good.Replace(", '/api/dq/'", ''); fail = $true },
        @{ name = 'a skipped test fails'; text = $good.Replace("test('every", "test.skip('every"); fail = $true }
    )
    foreach ($case in $cases) {
        $problems = @(Test-SmokeCoverage $case.text)
        $failed = $problems.Count -gt 0
        $mark = if ($failed -eq $case.fail) { 'ok  ' } else { 'FAIL' }
        Write-Host ("self-test {0} {1}" -f $mark, $case.name)
        if ($failed -ne $case.fail) { $failures.Add("$($case.name): problems [$($problems -join '; ')]") }
    }
    return $failures
}

# ---------------------------------------------------------------- servers

function Test-PortOpen([int]$Number) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect($Loopback, $Number, $null, $null)
        if (-not $wait.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($wait)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Get-Json([string]$Url) {
    try {
        $reply = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url
        if ($reply.StatusCode -ne 200) { return $null }
        return $reply.Content | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Test-PageAnswers([string]$Url) {
    try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url).StatusCode -eq 200 } catch { return $false }
}

function Stop-Tree([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process -or $Process.HasExited) { return }
    & taskkill.exe /PID $Process.Id /T /F *> $null
}

function Wait-Until([scriptblock]$Ready, [string]$What, [System.Diagnostics.Process]$Process) {
    $deadline = (Get-Date).AddSeconds($StartupSeconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Ready) { return }
        if ($Process.HasExited) { throw "$What exited with code $($Process.ExitCode) before it answered." }
        Start-Sleep -Milliseconds 500
    }
    throw "$What did not answer within $StartupSeconds seconds."
}

function Start-Logged([string]$File, [string[]]$Arguments, [string]$Directory, [string]$LogBase) {
    return Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $Directory -NoNewWindow -PassThru `
        -RedirectStandardOutput "$LogBase.out.log" -RedirectStandardError "$LogBase.err.log"
}

function Quote([string]$Text) { return '"' + $Text + '"' }

# ---------------------------------------------------------------- the session door (03 sections 2.6 and 4.2)

function Join-Arguments([string[]]$Arguments) {
    return (($Arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' ')
}

function New-HexString {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function ConvertFrom-HexString([string]$Hex) {
    $bytes = New-Object byte[] ($Hex.Length / 2)
    for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($Hex.Substring(2 * $i, 2), 16) }
    return , $bytes
}

function Test-SameText([string]$A, [string]$B) {
    if ($A.Length -ne $B.Length) { return $false }
    $difference = 0
    for ($i = 0; $i -lt $A.Length; $i++) { $difference = $difference -bor ([int][char]$A[$i] -bxor [int][char]$B[$i]) }
    return $difference -eq 0
}

function Invoke-LoopGet([string]$Url, [hashtable]$Headers = @{}, $Session = $null) {
    try {
        if ($null -ne $Session) { return Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url -Headers $Headers -WebSession $Session }
        return Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url -Headers $Headers
    } catch {
        return $null
    }
}

function Test-ProofAnswers([int]$Number) {
    $reply = Invoke-LoopGet "http://${Loopback}:$Number/api/desktop/proof?nonce=$('0' * 64)"
    return ($null -ne $reply) -and ($reply.StatusCode -eq 200) -and ($reply.Content -match '"proof"')
}

# The lock of the backend's own state folder: its port and token, once the backend has written it.
function Read-LockFile([string]$StateDir) {
    $path = Join-Path $StateDir 'backend.lock'
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
        $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
        try { $text = (New-Object System.IO.StreamReader($stream, $Utf8)).ReadToEnd() } finally { $stream.Dispose() }
        $document = $text | ConvertFrom-Json
        $token = [string]$document.token
        if ($token -notmatch '^[0-9a-f]{64}$') { return $null }
        return [pscustomobject]@{ Port = [int]$document.port; Token = $token }
    } catch {
        return $null
    }
}

# True only when the backend on $ConnectPort answers a fresh nonce with the MAC of the token holder (the token is not
# sent): HMAC-SHA256 keyed by the token's raw bytes over proof|nonce|port|pid (desktop/handshake.py). $MacPort is the
# port the backend names in its lock, which is the preview's port here, not the one it listens on.
function Test-Backend([int]$ConnectPort, [string]$TokenHex, [int]$MacPort) {
    $nonce = New-HexString
    $reply = Invoke-LoopGet "http://${Loopback}:$ConnectPort/api/desktop/proof?nonce=$nonce"
    if ($null -eq $reply -or $reply.StatusCode -ne 200) { return $false }
    try { $body = $reply.Content | ConvertFrom-Json } catch { return $false }
    $answerPid = 0
    if (-not [int]::TryParse("$($body.pid)", [ref]$answerPid)) { return $false }
    $hmac = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList (, (ConvertFrom-HexString $TokenHex))
    try {
        $mac = (($hmac.ComputeHash([System.Text.Encoding]::ASCII.GetBytes("proof|$nonce|$MacPort|$answerPid")) | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
        $hmac.Dispose()
    }
    return Test-SameText ([string]$body.proof) $mac
}

function Get-LaunchCode([int]$ApiPortNumber, [string]$TokenHex) {
    $reply = Invoke-LoopGet "http://${Loopback}:$ApiPortNumber/api/session/code" @{ Authorization = "NQT $TokenHex" }
    if ($null -eq $reply -or $reply.StatusCode -ne 200) { return $null }
    $code = [string]($reply.Content | ConvertFrom-Json).code
    if ($code -notmatch '^[0-9a-f]{64}$') { return $null }
    return $code
}

# The allow-listed environment for the backend (desktop/envlist.py, run by the venv Python): the base system names, the
# two Python settings and NQT_* only. No key, token or secret of this shell is in it. Built after this script has set
# the backend's own NQT_* values, so they are in the list.
function Get-AllowedEnvironment {
    $code = 'import json; from nq_terminal.desktop.envlist import backend_env; print(json.dumps(backend_env()))'
    Push-Location $Backend
    try {
        $lines = @(& $Python -X utf8 -c $code)
        $failed = $LASTEXITCODE -ne 0
    } finally {
        Pop-Location
    }
    if ($failed -or $lines.Count -eq 0) { throw 'could not build the allow-listed environment for the backend (desktop/envlist.py).' }
    $table = @{}
    foreach ($property in ($lines[$lines.Count - 1] | ConvertFrom-Json).PSObject.Properties) { $table[$property.Name] = [string]$property.Value }
    return $table
}

# A process with exactly `$Environment` as its environment (nothing inherited), no window, and its output copied to
# files. The copies run until the process ends; Close-Logs ends them.
$Logs = New-Object System.Collections.Generic.List[System.IO.Stream]
function Start-LoggedWithEnvironment([string]$File, [string[]]$Arguments, [string]$Directory, [string]$LogBase, [hashtable]$Environment) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = Join-Arguments $Arguments
    $info.WorkingDirectory = $Directory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables.Clear()
    foreach ($name in $Environment.Keys) { $info.EnvironmentVariables[$name] = $Environment[$name] }
    $process = [System.Diagnostics.Process]::Start($info)
    foreach ($pair in @(@($process.StandardOutput.BaseStream, "$LogBase.out.log"), @($process.StandardError.BaseStream, "$LogBase.err.log"))) {
        $logStream = [System.IO.File]::Open($pair[1], [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
        $Logs.Add($logStream)
        [void]$pair[0].CopyToAsync($logStream)
    }
    return $process
}

function Close-Logs {
    foreach ($log in $Logs) { try { $log.Dispose() } catch { Write-Verbose 'a log was already closed' } }
    $Logs.Clear()
}

# ---------------------------------------------------------------- app mode (04 D5.2; 03 section 15.1)

# What the shell logged about its own launch (`smoke_options`, one JSON line with every switch): the app mode may only count
# when the real backend ran (no --fixture, no --attach-url) over this lab, with a state folder, a WebView2 profile and a config
# folder of its own under the app-mode root. A launch without --state-dir would have used the lab's own terminal\state.
function Test-AppLaunchRecord([string]$LogText, [string]$ExpectedLab, [string]$Under) {
    $problems = New-Object System.Collections.Generic.List[string]
    $line = @($LogText -split "`n" | Where-Object { $_ -match '"event":"smoke_options"' }) | Select-Object -First 1
    if ($null -eq $line) { return @('the shell log has no smoke_options line: the launch cannot be checked') }
    try { $options = $line | ConvertFrom-Json } catch { return @('the smoke_options line is not JSON') }
    if ($options.fixture -ne $false) { $problems.Add('the app was started with --fixture: the real-data smoke needs the real backend') }
    if ($null -ne $options.attach_url) { $problems.Add('the app was started with --attach-url: there was no backend of its own') }
    if ("$($options.lab)".TrimEnd('\') -ne $ExpectedLab.TrimEnd('\')) { $problems.Add("the app served another lab: '$($options.lab)', not '$ExpectedLab'") }
    foreach ($name in @('state_dir', 'webview_data_dir', 'config_dir')) {
        $value = "$($options.$name)"
        if ($value -eq '') { $problems.Add("$name was not given: the shell would use a folder of its own, not a temporary one"); continue }
        if (-not $value.StartsWith($Under.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { $problems.Add("$name is '$value', not under $Under") }
    }
    return $problems
}

function Get-NewestAppRun([datetime]$Since) {
    $runs = Join-Path $AppRoot 'runs'
    if (-not (Test-Path -LiteralPath $runs)) { return $null }
    return Get-ChildItem -LiteralPath $runs -Directory -Filter 'smoke-app-*' |
        Where-Object { $_.CreationTime -ge $Since } | Sort-Object CreationTime -Descending | Select-Object -First 1
}

# Starts nothing itself: the project's global set-up (web\e2e\desktop\setup.ts) launches the hidden smoke build with the real
# backend, under the global window watch, with a PATH without the build tools, and reads DevToolsActivePort; the spec
# (web\e2e\desktop\smoke.app.ts) drives its page over the debugging protocol. Playwright only attaches; no browser is started.
function Invoke-AppRun {
    $exe = $SmokeExe
    if ($exe -eq '') { $exe = [Environment]::GetEnvironmentVariable('NQT_SMOKE_EXE', 'Process') }
    if ([string]::IsNullOrEmpty($exe)) { $exe = $DefaultSmokeExe }
    if (-not (Test-Path -LiteralPath $exe)) { throw "no smoke build at $exe (build one with cargo tauri build --no-bundle --features smoke, target under D:\dev\targets, or name it with -SmokeExe)" }
    if (-not (Test-Path -LiteralPath (Join-Path $Web 'dist\index.html'))) { throw 'web\dist is missing: build the page first (the smoke build refuses rebuilds)' }
    New-Item -ItemType Directory -Force -Path $AppRoot | Out-Null
    $env:NQT_DESKTOP_MODE = 'real'
    $env:NQT_SMOKE_EXE = $exe
    $env:NQT_APP_LAB = $Root
    $env:NQT_APP_RUNS = $AppRoot
    $env:NQT_JOBS = 'off'
    foreach ($name in @('NQT_FIXTURE_DIR', 'NQT_IB_READONLY', 'NQT_STATE_DIR', 'NQT_PORT', 'NQT_PREWARM', 'NQT_DESKTOP', 'NQT_STDIN_CONTROL')) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $testArgs = @($PlaywrightScript, 'test', '-c', 'playwright.desktop.config.ts')
    if ($Grep -ne '') { $testArgs += @('--grep', $Grep) }
    Push-Location -LiteralPath $Web
    try {
        & $node @testArgs | Out-Host
        return $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

function Invoke-AppSelfTest {
    $failures = New-Object System.Collections.Generic.List[string]
    $under = 'D:\dev\d5\smoke-app'
    $good = '{"event":"smoke_options","fixture":false,"attach_url":null,"lab":"C:\\lab","state_dir":"D:\\dev\\d5\\smoke-app\\runs\\r\\state","webview_data_dir":"D:\\dev\\d5\\smoke-app\\runs\\r\\wv","config_dir":"D:\\dev\\d5\\smoke-app\\runs\\r\\config"}'
    $cases = @(
        @{ name = 'a real launch with its own folders passes'; log = $good; fail = $false },
        @{ name = 'a launch with --fixture fails'; log = $good.Replace('"fixture":false', '"fixture":true'); fail = $true },
        @{ name = 'a launch with --attach-url fails'; log = $good.Replace('"attach_url":null', '"attach_url":"http://127.0.0.1:9/"'); fail = $true },
        @{ name = 'another lab fails'; log = $good.Replace('C:\\lab', 'C:\\other'); fail = $true },
        @{ name = 'no --state-dir (the lab''s own state folder) fails'; log = $good.Replace('"state_dir":"D:\\dev\\d5\\smoke-app\\runs\\r\\state"', '"state_dir":null'); fail = $true },
        @{ name = 'a WebView2 profile on C: fails'; log = $good.Replace('D:\\dev\\d5\\smoke-app\\runs\\r\\wv', 'C:\\Users\\x\\wv'); fail = $true },
        @{ name = 'a config folder outside the app-mode root fails'; log = $good.Replace('smoke-app\\runs\\r\\config', 'elsewhere\\config'); fail = $true },
        @{ name = 'a log with no smoke_options line fails'; log = '{"event":"start"}'; fail = $true }
    )
    foreach ($case in $cases) {
        $problems = @(Test-AppLaunchRecord $case.log 'C:\lab' $under)
        $failed = $problems.Count -gt 0
        $mark = if ($failed -eq $case.fail) { 'ok  ' } else { 'FAIL' }
        Write-Host ("self-test {0} {1}" -f $mark, $case.name)
        if ($failed -ne $case.fail) { $failures.Add("$($case.name): problems [$($problems -join '; ')]") }
    }
    $failures.AddRange([string[]]@(Invoke-LabRootSelfTest))
    foreach ($case in @(@{ inLab = $true; refused = $false; name = 'app mode in the lab''s own terminal folder is allowed' },
                        @{ inLab = $false; refused = $true; name = 'app mode in a worktree is refused' })) {
        $refusal = Get-AppModeRefusal $case.inLab
        $ok = ($null -ne $refusal) -eq $case.refused
        Write-Host ("self-test {0} {1}" -f $(if ($ok) { 'ok  ' } else { 'FAIL' }), $case.name)
        if (-not $ok) { $failures.Add("$($case.name): got '$refusal'") }
    }
    return $failures
}

# The shell's file reads are confined to the lab's real paths: a link to the lab's data or results folder resolves outside a
# lab of the worktree's own and is refused (nq_terminal.services.files, _confine). A worktree therefore cannot run the real
# backend over the real files in the app; that run needs the lab's own terminal folder (after the merge).
function Get-AppModeRefusal([bool]$InLabTerminal) {
    if ($InLabTerminal) { return $null }
    return 'app mode needs this terminal to be the nq-lab folder''s own terminal folder: the backend confines its reads to the real paths under the lab, so a worktree (a lab of its own that only links to the real data and results) answers 500 on every registry read. Run it from the lab after the merge, or use the default browser mode here.'
}

# A fake lab: the interpreter and the research package's config, nothing else.
function New-FakeLab([string]$Folder) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Folder '.venv\Scripts') | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $Folder '.venv\Scripts\python.exe') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Folder 'src\nq_lab') | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $Folder 'src\nq_lab\config.py') | Out-Null
}

# The lab root follows the folder this script sits in when that is the lab's own terminal folder, and the named or the
# default real lab when the checkout is a worktree; a checkout with neither has no research files to guard.
function Invoke-LabRootSelfTest {
    $failures = New-Object System.Collections.Generic.List[string]
    $base = Join-Path 'D:\dev\tmp' ("smoke-labroot-" + [guid]::NewGuid().ToString('N'))
    try {
        $inTreeLab = Join-Path $base 'inlab'
        New-FakeLab $inTreeLab
        New-Item -ItemType Directory -Force -Path (Join-Path $inTreeLab 'terminal') | Out-Null
        $realLab = Join-Path $base 'real'
        New-FakeLab $realLab
        $worktree = Join-Path $base 'wt\terminal'
        New-Item -ItemType Directory -Force -Path $worktree | Out-Null
        $cases = @(
            @{ name = 'the terminal folder of a lab gives that lab'; terminal = (Join-Path $inTreeLab 'terminal'); named = ''; expect = $inTreeLab },
            @{ name = 'a worktree gives the named real lab'; terminal = $worktree; named = $realLab; expect = $realLab },
            @{ name = 'a worktree with no named lab and none under the profile gives none'; terminal = $worktree; named = ''; profile = $base; expectNone = $true },
            @{ name = 'a worktree with a named folder that is no lab gives none'; terminal = $worktree; named = (Join-Path $base 'wt'); expectNone = $true }
        )
        foreach ($case in $cases) {
            $profileDir = if ($case.ContainsKey('profile')) { $case.profile } else { Join-Path $base 'noprofile' }
            $got = Resolve-LabRoot $case.terminal $case.named $profileDir
            $ok = if ($case.ContainsKey('expectNone')) { $null -eq $got } else { "$got" -eq $case.expect }
            Write-Host ("self-test {0} {1}" -f $(if ($ok) { 'ok  ' } else { 'FAIL' }), $case.name)
            if (-not $ok) { $failures.Add("$($case.name): got '$got'") }
        }
        $profileLab = Join-Path $base 'profile'
        New-FakeLab (Join-Path $profileLab 'nq-lab')
        $got = Resolve-LabRoot $worktree '' $profileLab
        $ok = "$got" -eq (Join-Path $profileLab 'nq-lab')
        Write-Host ("self-test {0} {1}" -f $(if ($ok) { 'ok  ' } else { 'FAIL' }), 'a worktree without a named lab falls back to nq-lab under the profile')
        if (-not $ok) { $failures.Add("profile fallback: got '$got'") }
    } finally {
        if (Test-Path -LiteralPath $base) { Remove-Item -LiteralPath $base -Recurse -Force }
    }
    return $failures
}

# ---------------------------------------------------------------- run

$selfFailures = @(Invoke-SelfTest) + @(Invoke-AppSelfTest) + @(Invoke-StateSelfTest)
if ($selfFailures.Count -gt 0) { Stop-Smoke ("the self-test failed: " + ($selfFailures -join ' | ')) }
if (-not (Test-Path -LiteralPath $SmokeSpec)) { Stop-Smoke "missing: $SmokeSpec" }
$coverage = @(Test-SmokeCoverage ([System.IO.File]::ReadAllText($SmokeSpec, $Utf8)))
if ($coverage.Count -gt 0) { Stop-Smoke ("the smoke spec misses Phase 11 coverage ($SmokeSpec): " + ($coverage -join ' | ')) }
Write-Output "smoke spec opens $($P11Codes -join ', ') and scans their answers for the fence: $SmokeSpec"
if ($SelfTest) { Write-Output 'self-test passed: every check fails on broken input and passes on clean input.'; exit 0 }

if ($Mode -eq 'App') {
    $refusal = Get-AppModeRefusal $InLab
    if ($null -ne $refusal) { Stop-Smoke $refusal }
}
if ($Mode -eq 'Browser') {
    foreach ($port in @($ApiPort, $WebPort)) {
        if ($port -eq $UserPort) { Stop-Smoke "port $UserPort is the user's own backend; choose another." }
        if (Test-PortOpen $port) { Stop-Smoke "port $port on $Loopback is taken; choose another with -ApiPort or -WebPort." }
    }
    if ($ApiPort -eq $WebPort) { Stop-Smoke 'ApiPort and WebPort must differ.' }
}
$needs = @($Python, $PlaywrightScript, (Join-Path $Results $LogName))
if ($Mode -eq 'Browser') { $needs += $ViteScript }
foreach ($need in $needs) {
    if (-not (Test-Path -LiteralPath $need)) { Stop-Smoke "missing: $need" }
}
$node = (Get-Command node -ErrorAction Stop).Source

$StartedAt = Get-Date
$WorkBase = if ($Mode -eq 'App') { $AppRoot } else { [System.IO.Path]::GetTempPath() }
$Work = Join-Path $WorkBase ("nqt-smoke-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$Out = Join-Path $Work 'dist'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
Write-Output "work folder: $Work"

$before = Get-Snapshot $Results
Write-Output "before: log $($before.log_length) bytes; $(($PinnedFiles | ForEach-Object { "$_ $($before.files[$_].Substring(0, 12))" }) -join ', ')"

$started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$saved = @{}
foreach ($name in @('NQT_PORT', 'NQT_CACHE_BYTES', 'NQT_FIXTURE_DIR', 'NQT_IB_READONLY', 'NQT_STATE_DIR', 'NQT_JOBS', 'NQT_PREWARM', 'NQT_DESKTOP', 'NQT_STDIN_CONTROL', 'PYTHONUTF8', 'PYTHONIOENCODING', 'NQT_SMOKE_API_ORIGIN', 'NQT_SMOKE_WEB_ORIGIN', 'NQT_SMOKE_SESSION_URL', 'NQT_DESKTOP_MODE', 'NQT_SMOKE_EXE', 'NQT_APP_LAB', 'NQT_APP_RUNS')) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$testsExit = -1
$State = $null
$serverProblems = New-Object System.Collections.Generic.List[string]
try {
    if ($Mode -eq 'App') {
        Write-Output 'app mode: the hidden smoke build starts the real backend itself; no vite build, no preview'
        $testsExit = Invoke-AppRun
    } else {
        Write-Output 'build: vite build into the work folder'
        $build = Start-Process -FilePath $node -ArgumentList @((Quote $ViteScript), 'build', '--outDir', (Quote $Out), '--emptyOutDir', '--logLevel', 'warn') `
            -WorkingDirectory $Web -NoNewWindow -PassThru -Wait -RedirectStandardOutput (Join-Path $Work 'build.out.log') -RedirectStandardError (Join-Path $Work 'build.err.log')
        if ($build.ExitCode -ne 0) { throw "vite build failed with code $($build.ExitCode); see $Work\build.err.log" }

        [Environment]::SetEnvironmentVariable('NQT_FIXTURE_DIR', $null, 'Process')
        # A smoke run must never reach the owner's TWS, whatever the shell sets: the IB snapshot stays off.
        [Environment]::SetEnvironmentVariable('NQT_IB_READONLY', $null, 'Process')
        # The backend's same-origin check accepts the terminal port, which is the preview in front of it.
        # The backend keeps its result cache and jobs file in its state folder: a smoke run gets its own, inside the work
        # folder, so it never writes the owner's terminal\state. The queue is off and the HOME prewarm is off, so the run
        # reads exactly what the page asks for.
        $State = New-SmokeState $Work
        foreach ($name in @('NQT_PREWARM', 'NQT_DESKTOP', 'NQT_STDIN_CONTROL')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
        $env:NQT_PORT = "$WebPort"
        $env:NQT_CACHE_BYTES = "$(1024 * 1024 * 1024)"
        $env:PYTHONUTF8 = '1'
        $env:PYTHONIOENCODING = 'utf-8'
        $apiArgs = @('-m', 'uvicorn', 'nq_terminal.app:create_app', '--factory', '--app-dir', $Backend,
            '--host', $Loopback, '--port', "$ApiPort", '--no-server-header', '--no-proxy-headers')
        $allowed = Get-AllowedEnvironment
        $api = Start-LoggedWithEnvironment $Python $apiArgs $Backend (Join-Path $Work 'backend') $allowed
        $started.Add($api)
        # Every /api path but the proof route needs a session, so readiness is the proof route.
        Wait-Until { Test-ProofAnswers $ApiPort } "The backend on ${Loopback}:$ApiPort" $api
        # The token is in the lock of the backend's own state folder; use it only after the backend proves it holds it.
        $lock = $null
        Wait-Until { $script:lock = Read-LockFile $State; $null -ne $script:lock } "The lock of the backend on ${Loopback}:$ApiPort" $api
        if (-not (Test-Backend $ApiPort $lock.Token $lock.Port)) { throw "the backend on ${Loopback}:$ApiPort did not prove that it holds the token in its lock; not using it." }
        $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        $probeCode = Get-LaunchCode $ApiPort $lock.Token
        if ($null -eq $probeCode) { throw "the backend on ${Loopback}:$ApiPort did not issue a launch code." }
        $null = Invoke-LoopGet "http://${Loopback}:$ApiPort/api/session/redeem" @{ 'X-NQT-Code' = $probeCode } $session
        $healthReply = Invoke-LoopGet "http://${Loopback}:$ApiPort/api/health" @{} $session
        if ($null -eq $healthReply) { throw "the backend on ${Loopback}:$ApiPort refused a session it had just issued." }
        $health = $healthReply.Content | ConvertFrom-Json
        if ($health.fixture_mode -ne $false) { throw 'the second backend answers in fixture mode; the smoke run needs the real files.' }
        Write-Output "backend: ${Loopback}:$ApiPort, real files, fence $($health.fence.is_start) to $($health.fence.is_end), own state folder, jobs off, allow-listed environment"

        $env:NQT_SMOKE_API_ORIGIN = "http://${Loopback}:$ApiPort"
        $previewArgs = @((Quote $ViteScript), 'preview', '--config', 'e2e/perf/real.preview.config.ts', '--outDir', (Quote $Out),
            '--port', "$WebPort", '--strictPort')
        $preview = Start-Logged $node $previewArgs $Web (Join-Path $Work 'preview')
        $started.Add($preview)
        Wait-Until { Test-PageAnswers "http://${Loopback}:$WebPort/" } "vite preview on ${Loopback}:$WebPort" $preview
        Write-Output "preview: http://${Loopback}:$WebPort/ (api proxied to $ApiPort)"

        $env:NQT_SMOKE_WEB_ORIGIN = "http://${Loopback}:$WebPort"
        # One launch code for the preview origin, made at the last moment (it works once and lives 60 seconds): Playwright's
        # global set-up opens this address in a headless browser, which redeems it and keeps the cookie.
        $launchCode = Get-LaunchCode $ApiPort $lock.Token
        if ($null -eq $launchCode) { throw "the backend on ${Loopback}:$ApiPort did not issue a launch code for the preview." }
        $env:NQT_SMOKE_SESSION_URL = "http://${Loopback}:$WebPort/session.html#$launchCode"
        $testArgs = @($PlaywrightScript, 'test', '--config', 'e2e/perf/real.config.ts')
        if ($Grep -ne '') { $testArgs += @('--grep', $Grep) }
        Push-Location -LiteralPath $Web
        try {
            & $node @testArgs
            $testsExit = $LASTEXITCODE
        } finally {
            Pop-Location
        }
    }
} catch {
    $serverProblems.Add($_.Exception.Message)
} finally {
    foreach ($p in $started) { Stop-Tree $p }
    Close-Logs
    # The backend has stopped: its temporary state folder goes, so the run leaves only its logs and summary in the work folder.
    if ($null -ne $State -and -not (Remove-SmokeState $Work $State)) { $serverProblems.Add("the temporary state folder $State could not be removed") }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}

$after = Get-Snapshot $Results
$log = Test-Log $Results $before
$fileProblems = @(Compare-Files $before $after)
$appProblems = @()
if ($Mode -eq 'App') {
    # The shell's own log says how the app was launched; a fixture launch, or one without a state folder of its own, does not count.
    $appRun = Get-NewestAppRun $StartedAt
    $shellLog = if ($null -ne $appRun) { Join-Path $appRun.FullName 'config\logs\shell.log' } else { '' }
    if ($shellLog -ne '' -and (Test-Path -LiteralPath $shellLog)) {
        $appProblems = @(Test-AppLaunchRecord ([System.IO.File]::ReadAllText($shellLog, $Utf8)) $Root $AppRoot)
    } else {
        $appProblems = @("the app run left no shell log under $AppRoot (it did not start)")
    }
}
$problems = @($serverProblems) + @($log.problems) + @($fileProblems) + @($appProblems)
if ($testsExit -ne 0) { $problems += "the Playwright smoke run exited with code $testsExit" }

$bySeries = @($log.entries | Group-Object -Property symbol, timeframe, variant | ForEach-Object { "$($_.Name) x$($_.Count)" })
$summary = [ordered]@{
    finished_utc = (Get-Date).ToUniversalTime().ToString('o')
    mode = $Mode
    api_port = $ApiPort
    web_port = $WebPort
    playwright_exit = $testsExit
    app_launch_checked = ($Mode -eq 'App')
    app_run = if ($Mode -eq 'App' -and $null -ne $appRun) { $appRun.FullName } else { $null }
    new_log_lines = $log.new_lines
    other_workflow_log_lines = $log.other_workflow_lines
    new_log_lines_all_terminal_in_window = ($log.problems.Count -eq 0)
    new_log_series = $bySeries
    research_files_unchanged = ($fileProblems.Count -eq 0)
    before = $before
    after = $after
    problems = $problems
}
$summaryPath = Join-Path $Work 'smoke_summary.json'
[System.IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 6), $Utf8)
Remove-Item -LiteralPath $Out -Recurse -Force -ErrorAction SilentlyContinue

Write-Output ''
Write-Output "new log lines: $($log.new_lines), of them $($log.other_workflow_lines) from other workflows (the rest all caller '$ExpectedCaller', inside [2010-01-01, 2022-01-01): $($log.problems.Count -eq 0))"
foreach ($s in $bySeries) { Write-Output "  $s" }
Write-Output "research files unchanged: $($fileProblems.Count -eq 0) ($($PinnedFiles -join ', '))"
Write-Output "summary: $summaryPath"
if ($problems.Count -gt 0) {
    foreach ($p in $problems) { Write-Output "PROBLEM: $p" }
    exit 1
}
Write-Output 'smoke run passed.'
exit 0
