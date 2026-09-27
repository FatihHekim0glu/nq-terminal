<#
.SYNOPSIS
  Real-data smoke run of the nq-lab terminal (read only), TASKS 8.3.

.DESCRIPTION
  From the nq-lab folder:
    powershell -NoProfile -ExecutionPolicy Bypass -File terminal\scripts\smoke_real.ps1

  1. Runs its own self-test first: the log and file checks below must fail on broken input.
  2. Records the sha256 of results\ledger.csv, results\registry.csv and results\oos_openings.json, and the
     length and sha256 of results\oos_access_log.jsonl.
  3. Builds the web app into a temporary folder (web\dist and web\dist-gallery are not touched).
  4. Starts a second backend with the venv Python (uvicorn, nq_terminal.app:create_app) on
     127.0.0.1:ApiPort against the real data root (NQT_FIXTURE_DIR removed), and vite preview of that
     build on 127.0.0.1:WebPort with /api proxied to it. The user's own backend on 8765 is never used.
  5. Runs web\e2e\perf\real.config.ts: the trace arithmetic checks, then smoke.real.ts (every screen on
     real files, and the performance budgets measured on real data with a CDP trace).
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
  Run only the self-test of the checks, on files in a temporary folder, and start nothing.
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$ApiPort = 8953,
    [ValidateRange(1024, 65535)]
    [int]$WebPort = 4953,
    [string]$Grep = '',
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Terminal = Split-Path -Parent $PSScriptRoot
$Root = Split-Path -Parent $Terminal
$Backend = Join-Path $Terminal 'backend'
$Web = Join-Path $Terminal 'web'
$Results = Join-Path $Root 'results'
$Python = Join-Path $Root '.venv\Scripts\python.exe'
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

function Stop-Smoke([string]$Message) {
    [Console]::Error.WriteLine("smoke_real.ps1: $Message")
    exit 1
}

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

function Test-Log([string]$ResultsDir, [object]$Before) {
    $path = Join-Path $ResultsDir $LogName
    $problems = New-Object System.Collections.Generic.List[string]
    $prefix = Get-PrefixSha256 $path $Before.log_length
    if ($prefix -ne $Before.log_prefix_sha256) { $problems.Add("the log's earlier bytes changed ($prefix): it is no longer append only") }
    $text = Read-NewLogText $path $Before.log_length
    $lines = @()
    if ($null -ne $text) { $lines = @($text -split "`n" | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_ -ne '' }) }
    $entries = New-Object System.Collections.Generic.List[object]
    foreach ($line in $lines) {
        $problem = Test-LogLine $line
        if ($null -ne $problem) { $problems.Add($problem); continue }
        $e = $line | ConvertFrom-Json
        $entries.Add([pscustomobject]@{ symbol = "$($e.symbol)"; timeframe = "$($e.timeframe)"; variant = "$($e.variant)"; start = "$($e.start)"; end = "$($e.end)" })
    }
    return [pscustomobject]@{ new_lines = $lines.Count; entries = $entries; problems = $problems }
}

function Compare-Files([object]$Before, [object]$After) {
    $problems = New-Object System.Collections.Generic.List[string]
    foreach ($name in $PinnedFiles) {
        if ($Before.files[$name] -ne $After.files[$name]) { $problems.Add("$name changed: $($Before.files[$name]) then $($After.files[$name])") }
    }
    return $problems
}

# ---------------------------------------------------------------- self-test (born failing)

function Invoke-SelfTest {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("nqt-smoke-selftest-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $failures = New-Object System.Collections.Generic.List[string]
    $good = '{"ts_utc": "2026-09-27T08:00:00+00:00", "caller": "terminal", "reason": "terminal display", "start": "2010-01-01 00:00:00+00:00", "end": "2022-01-01 00:00:00+00:00", "rows": 3, "symbol": "NQ.V.0", "timeframe": "1d", "variant": "vendor"}'
    $cases = @(
        @{ name = 'terminal lines inside the window pass'; append = @($good); edit = $null; fail = $false },
        @{ name = 'another caller fails'; append = @($good.Replace('"caller": "terminal"', '"caller": "za_screen"')); edit = $null; fail = $true },
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

# ---------------------------------------------------------------- run

$selfFailures = @(Invoke-SelfTest)
if ($selfFailures.Count -gt 0) { Stop-Smoke ("the self-test failed: " + ($selfFailures -join ' | ')) }
if ($SelfTest) { Write-Output 'self-test passed: every check fails on broken input and passes on clean input.'; exit 0 }

foreach ($port in @($ApiPort, $WebPort)) {
    if ($port -eq $UserPort) { Stop-Smoke "port $UserPort is the user's own backend; choose another." }
    if (Test-PortOpen $port) { Stop-Smoke "port $port on $Loopback is taken; choose another with -ApiPort or -WebPort." }
}
if ($ApiPort -eq $WebPort) { Stop-Smoke 'ApiPort and WebPort must differ.' }
foreach ($need in @($Python, $ViteScript, $PlaywrightScript, (Join-Path $Results $LogName))) {
    if (-not (Test-Path -LiteralPath $need)) { Stop-Smoke "missing: $need" }
}
$node = (Get-Command node -ErrorAction Stop).Source

$Work = Join-Path ([System.IO.Path]::GetTempPath()) ("nqt-smoke-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$Out = Join-Path $Work 'dist'
New-Item -ItemType Directory -Path $Work | Out-Null
Write-Output "work folder: $Work"

$before = Get-Snapshot $Results
Write-Output "before: log $($before.log_length) bytes; $(($PinnedFiles | ForEach-Object { "$_ $($before.files[$_].Substring(0, 12))" }) -join ', ')"

$started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$saved = @{}
foreach ($name in @('NQT_PORT', 'NQT_CACHE_BYTES', 'NQT_FIXTURE_DIR', 'PYTHONUTF8', 'PYTHONIOENCODING', 'NQT_SMOKE_API_ORIGIN', 'NQT_SMOKE_WEB_ORIGIN')) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$testsExit = -1
$serverProblems = New-Object System.Collections.Generic.List[string]
try {
    Write-Output 'build: vite build into the work folder'
    $build = Start-Process -FilePath $node -ArgumentList @((Quote $ViteScript), 'build', '--outDir', (Quote $Out), '--emptyOutDir', '--logLevel', 'warn') `
        -WorkingDirectory $Web -NoNewWindow -PassThru -Wait -RedirectStandardOutput (Join-Path $Work 'build.out.log') -RedirectStandardError (Join-Path $Work 'build.err.log')
    if ($build.ExitCode -ne 0) { throw "vite build failed with code $($build.ExitCode); see $Work\build.err.log" }

    [Environment]::SetEnvironmentVariable('NQT_FIXTURE_DIR', $null, 'Process')
    # The backend's same-origin check accepts the terminal port, which is the preview in front of it.
    $env:NQT_PORT = "$WebPort"
    $env:NQT_CACHE_BYTES = "$(1024 * 1024 * 1024)"
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $apiArgs = @('-m', 'uvicorn', 'nq_terminal.app:create_app', '--factory', '--app-dir', (Quote $Backend),
        '--host', $Loopback, '--port', "$ApiPort", '--no-server-header', '--no-proxy-headers')
    $api = Start-Logged $Python $apiArgs $Backend (Join-Path $Work 'backend')
    $started.Add($api)
    Wait-Until { $null -ne (Get-Json "http://${Loopback}:$ApiPort/api/health") } "The backend on ${Loopback}:$ApiPort" $api
    $health = Get-Json "http://${Loopback}:$ApiPort/api/health"
    if ($health.fixture_mode -ne $false) { throw 'the second backend answers in fixture mode; the smoke run needs the real files.' }
    Write-Output "backend: ${Loopback}:$ApiPort, real files, fence $($health.fence.is_start) to $($health.fence.is_end)"

    $env:NQT_SMOKE_API_ORIGIN = "http://${Loopback}:$ApiPort"
    $previewArgs = @((Quote $ViteScript), 'preview', '--config', 'e2e/perf/real.preview.config.ts', '--outDir', (Quote $Out),
        '--port', "$WebPort", '--strictPort')
    $preview = Start-Logged $node $previewArgs $Web (Join-Path $Work 'preview')
    $started.Add($preview)
    Wait-Until { Test-PageAnswers "http://${Loopback}:$WebPort/" } "vite preview on ${Loopback}:$WebPort" $preview
    Write-Output "preview: http://${Loopback}:$WebPort/ (api proxied to $ApiPort)"

    $env:NQT_SMOKE_WEB_ORIGIN = "http://${Loopback}:$WebPort"
    $testArgs = @($PlaywrightScript, 'test', '--config', 'e2e/perf/real.config.ts')
    if ($Grep -ne '') { $testArgs += @('--grep', $Grep) }
    Push-Location -LiteralPath $Web
    try {
        & $node @testArgs
        $testsExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} catch {
    $serverProblems.Add($_.Exception.Message)
} finally {
    foreach ($p in $started) { Stop-Tree $p }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}

$after = Get-Snapshot $Results
$log = Test-Log $Results $before
$fileProblems = @(Compare-Files $before $after)
$problems = @($serverProblems) + @($log.problems) + @($fileProblems)
if ($testsExit -ne 0) { $problems += "the Playwright smoke run exited with code $testsExit" }

$bySeries = @($log.entries | Group-Object -Property symbol, timeframe, variant | ForEach-Object { "$($_.Name) x$($_.Count)" })
$summary = [ordered]@{
    finished_utc = (Get-Date).ToUniversalTime().ToString('o')
    api_port = $ApiPort
    web_port = $WebPort
    playwright_exit = $testsExit
    new_log_lines = $log.new_lines
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
Write-Output "new log lines: $($log.new_lines) (all caller '$ExpectedCaller', inside [2010-01-01, 2022-01-01): $($log.problems.Count -eq 0))"
foreach ($s in $bySeries) { Write-Output "  $s" }
Write-Output "research files unchanged: $($fileProblems.Count -eq 0) ($($PinnedFiles -join ', '))"
Write-Output "summary: $summaryPath"
if ($problems.Count -gt 0) {
    foreach ($p in $problems) { Write-Output "PROBLEM: $p" }
    exit 1
}
Write-Output 'smoke run passed.'
exit 0
