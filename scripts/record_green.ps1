<#
.SYNOPSIS
  Runs one of the four release checks and, only when it passes, writes a dated, stamped green record.

.DESCRIPTION
  From any folder:
    powershell -NoProfile -File terminal\scripts\record_green.ps1 -Check backend|crosscheck|smoke|smoke-app
    powershell -NoProfile -File terminal\scripts\record_green.ps1 -Stamp        (print the provenance stamp as JSON)

  The checks, exactly as the roadmap names them (04 D5.4, 05 S08):
    backend     the lab's venv Python, pytest over terminal\backend\tests (cwd: the lab)
    crosscheck  uv run --project terminal\qa python -m crosscheck --strict, then python -m crosscheck.served
                (G2: both must pass; the second launches the hidden desktop build itself)
    smoke       scripts\smoke_real.ps1 (the real-data smoke, browser mode)
    smoke-app   scripts\smoke_real.ps1 -Mode App (the same checks driven through the hidden desktop build)

  On exit code 0 it writes terminal\state\release\<date>_<check>.json (git-ignored) with the date (local), this
  PC's name, the exit code, the counts read from the output and the provenance stamp. On any other exit code
  nothing is written, and an older record of the same name is left alone. The stamp is taken before and after the
  run; a tree that changed while the check ran gets no record, because the record would describe a tree that no
  longer exists.

  The provenance stamp (one definition, used by build-release.ps1 and release_check.ps1 through -Stamp):
    head              git rev-parse HEAD
    diff_sha256       sha256 of the raw bytes of `git diff HEAD`
    untracked_sha256  sha256 over the files of `git ls-files --others --exclude-standard`, sorted by ordinal name;
                      for each file the UTF-8 name, a zero byte, its bytes, a zero byte


  Inputs outside the tree stamp (the record's "inputs" block, and "started_utc"): crosscheck records the smoke exe
  (path, sha256), the sha256 of web\dist (sorted names plus file hashes) and of the QA dump folder (with its newest
  write time); smoke-app records the smoke exe and web\dist. The exe is -SmokeExe, else NQT_SMOKE_EXE, else the default
  smoke target, and the check is launched with NQT_SMOKE_EXE set to that same exe (the caller's value is put back
  afterwards), so the exe a record names is the exe that ran. A run whose inputs changed while it ran gets no record. `-Inputs` prints them as JSON.
  Python is only ever started by full path with -m. Nothing is written outside the records folder.
.PARAMETER Check
  backend, crosscheck, smoke or smoke-app.
.PARAMETER Stamp
  Print the provenance stamp of the tree as JSON and exit.
.PARAMETER RecordsDir
  Where records go (default terminal\state\release).
.PARAMETER Lab
  The nq-lab folder (default: the parent of terminal when it holds a .venv, else $env:NQT_LAB, else the owner's
  C:\Users\<user>\nq-lab). Any lab other than the parent of terminal is a self-test hook (see -Exe): it needs an
  explicit -RecordsDir and the record carries self_test = true.
.PARAMETER TreeRoot
  Self-test hook: stamp this git tree instead of terminal (scripts/tests/release_check.tests.ps1).
.PARAMETER Exe
  Self-test hook: run this program instead of the named check's own command. -Exe and -TreeRoot need an explicit
  -RecordsDir (exit 2 otherwise), and the record they write carries self_test = true, which release_check.ps1 refuses.
.PARAMETER ExeArgs
  Self-test hook: its arguments.
#>
[CmdletBinding()]
param(
    [ValidateSet('backend', 'crosscheck', 'smoke', 'smoke-app')]
    [string]$Check = '',
    [switch]$Stamp,
    [switch]$Inputs,
    [string]$SmokeExe = '',
    [string]$DistDir = '',
    [string]$DumpsDir = '',
    [string]$RecordsDir = '',
    [string]$Lab = '',
    [string]$TreeRoot = '',
    [string]$Exe = '',
    [string[]]$ExeArgs = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Terminal = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$StampRoot = if ($TreeRoot) { $TreeRoot } else { $Terminal }

function Invoke-GitBytes {
    # Raw stdout bytes of a git command (no text decoding, so the hash is of what git wrote).
    param([string]$Repo, [string]$GitArguments)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = 'git'
    $info.Arguments = "-C `"$Repo`" $GitArguments"
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $proc = [System.Diagnostics.Process]::Start($info)
    $errTask = $proc.StandardError.ReadToEndAsync()
    $buffer = New-Object System.IO.MemoryStream
    $proc.StandardOutput.BaseStream.CopyTo($buffer)
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { throw "git $GitArguments failed ($($proc.ExitCode)): $($errTask.Result)" }
    return , $buffer.ToArray()
}

function Get-HexSha256 {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes)) -replace '-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Get-UntrackedSha256 {
    param([string]$Repo)
    $raw = $Utf8.GetString((Invoke-GitBytes $Repo 'ls-files --others --exclude-standard -z'))
    $names = @($raw.Split([char]0) | Where-Object { $_ -ne '' })
    [System.Array]::Sort($names, [System.StringComparer]::Ordinal)
    $hasher = [System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $zero = [byte[]]@(0)
    $counted = 0
    foreach ($name in $names) {
        $file = Join-Path $Repo $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        $hasher.AppendData($Utf8.GetBytes($name)); $hasher.AppendData($zero)
        $hasher.AppendData([System.IO.File]::ReadAllBytes($file)); $hasher.AppendData($zero)
        $counted++
    }
    $hex = ([System.BitConverter]::ToString($hasher.GetHashAndReset()) -replace '-', '').ToLowerInvariant()
    $hasher.Dispose()
    return @{ sha256 = $hex; count = $counted }
}

function Get-ProvenanceStamp {
    param([string]$Repo)
    $head = ([System.Text.Encoding]::ASCII.GetString((Invoke-GitBytes $Repo 'rev-parse HEAD'))).Trim()
    $diff = Get-HexSha256 (Invoke-GitBytes $Repo 'diff HEAD')
    $untracked = Get-UntrackedSha256 $Repo
    return [ordered]@{ head = $head; diff_sha256 = $diff; untracked_sha256 = $untracked.sha256; untracked_count = $untracked.count }
}

function Resolve-Lab {
    param([string]$Given)
    if ($Given) { return $Given }
    $parent = Split-Path $Terminal -Parent
    if (Test-Path -LiteralPath (Join-Path $parent '.venv\Scripts\python.exe')) { return $parent }
    if ($env:NQT_LAB) { return $env:NQT_LAB }
    return (Join-Path $env:USERPROFILE 'nq-lab')
}

function Get-CheckCommand {
    # The program, its arguments and its working folder for one named check.
    param([string]$Name, [string]$LabDir)
    $python = Join-Path $LabDir '.venv\Scripts\python.exe'
    $smoke = Join-Path $Terminal 'scripts\smoke_real.ps1'
    $ps = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $smoke)
    switch ($Name) {
        'backend' { return @{ exe = $python; args = @('-m', 'pytest', '-p', 'no:warnings', '-o', 'addopts=', '-q', (Join-Path $Terminal 'backend\tests')); cwd = $LabDir } }
        'crosscheck' {
            # G2 needs both: the strict comparison of the dumps, then the served JSON of the hidden app (neither passes alone).
            $uv = @('run', '--project', (Join-Path $Terminal 'qa'), 'python', '-m')
            return @{ exe = 'uv'; args = ($uv + @('crosscheck', '--strict')); cwd = (Join-Path $Terminal 'qa')
                      then = @{ exe = 'uv'; args = ($uv + @('crosscheck.served')); cwd = (Join-Path $Terminal 'qa') } }
        }
        'smoke' { return @{ exe = 'powershell'; args = $ps; cwd = $LabDir } }
        'smoke-app' { return @{ exe = 'powershell'; args = ($ps + @('-Mode', 'App')); cwd = $LabDir } }
    }
}

function Format-CommandText {
    # "exe args" for one command, with its `then` command after " ; then " (the text release_check.ps1 matches).
    param([hashtable]$Command)
    $text = "$($Command.exe) $($Command.args -join ' ')"
    if ($Command.ContainsKey('then')) { $text += " ; then $($Command.then.exe) $($Command.then.args -join ' ')" }
    return $text
}

function Read-Counts {
    # What the check printed, as numbers. Only figures that the output states are recorded.
    param([string]$Name, [string[]]$Lines)
    $text = $Lines -join "`n"
    $counts = [ordered]@{}
    if ($Name -eq 'backend') {
        foreach ($word in 'passed', 'failed', 'skipped', 'error', 'errors', 'xfailed', 'xpassed', 'deselected') {
            $hit = [regex]::Matches($text, "(\d+) $word\b")
            if ($hit.Count -gt 0) { $counts[$word] = [int]$hit[$hit.Count - 1].Groups[1].Value }
        }
    } elseif ($Name -eq 'crosscheck') {
        $dumps = [regex]::Match($text, 'crosscheck: (\d+) dumps')
        if ($dumps.Success) { $counts['dumps'] = [int]$dumps.Groups[1].Value }
        $summary = [regex]::Matches($text, '(?m)^summary: (.+)$')
        if ($summary.Count -gt 0) {
            foreach ($m in [regex]::Matches($summary[$summary.Count - 1].Groups[1].Value, '([A-Z_]+) (\d+)')) { $counts[$m.Groups[1].Value.ToLowerInvariant()] = [int]$m.Groups[2].Value }
        }
    } else {
        $logLines = [regex]::Match($text, 'new log lines: (\d+)')
        if ($logLines.Success) { $counts['new_log_lines'] = [int]$logLines.Groups[1].Value }
        $unchanged = [regex]::Match($text, 'research files unchanged: (True|False)')
        if ($unchanged.Success) { $counts['research_files_unchanged'] = ($unchanged.Groups[1].Value -eq 'True') }
    }
    return $counts
}

function Invoke-Check {
    # Runs the command (and its `then` command, only after a pass) with the output shown and kept; returns the
    # exit code of the last command run and all the lines.
    param([hashtable]$Command)
    $env:PYTHONPATH = Join-Path $Terminal 'backend'
    $env:UV_CACHE_DIR = 'D:\dev\uv-cache'
    # The exe the record names is the exe the check launches: export the resolved path for the child processes
    # (smoke_real.ps1 -Mode App and web\e2e\desktop\launch.ts read NQT_SMOKE_EXE), and put the caller's value back after.
    # An absent default build is not exported, so the launcher's own fallback still applies (and the record says none).
    $smokeBefore = [Environment]::GetEnvironmentVariable('NQT_SMOKE_EXE', 'Process')
    $smokePath = Resolve-SmokeExePath
    if ($SmokeExe -or (Test-Path -LiteralPath $smokePath -PathType Leaf)) { $env:NQT_SMOKE_EXE = $smokePath }
    try { return (Invoke-CheckSteps $Command) } finally { [Environment]::SetEnvironmentVariable('NQT_SMOKE_EXE', $smokeBefore, 'Process') }
}

function Invoke-CheckSteps {
    param([hashtable]$Command)
    $lines = New-Object System.Collections.Generic.List[string]
    $step = $Command
    $code = 0
    while ($step) {
        Push-Location $step.cwd
        try {
            $ErrorActionPreference = 'Continue'
            & $step.exe @($step.args) 2>&1 | ForEach-Object { $text = $_.ToString(); $lines.Add($text); Write-Host $text }
            $code = $LASTEXITCODE
            $ErrorActionPreference = 'Stop'
        } finally { Pop-Location }
        $step = if ($code -eq 0 -and $step.ContainsKey('then')) { $step.then } else { $null }
    }
    return @{ code = $code; lines = $lines.ToArray() }
}

function Test-SameStamp {
    param($A, $B)
    return ($A.head -eq $B.head) -and ($A.diff_sha256 -eq $B.diff_sha256) -and ($A.untracked_sha256 -eq $B.untracked_sha256)
}

function Get-TreeHash {
    # sha256 over the sorted (ordinal) relative names of a folder's files, each followed by that file's sha256, plus the
    # count and the newest write time (UTC, round-trip format). $null when the folder is missing or holds no file.
    param([string]$Folder, [string]$Filter = '*')
    if (-not $Folder -or -not (Test-Path -LiteralPath $Folder -PathType Container)) { return $null }
    $root = (Resolve-Path -LiteralPath $Folder).Path.TrimEnd('\') + '\'
    $files = @(Get-ChildItem -LiteralPath $Folder -Recurse -File -Filter $Filter)
    if ($files.Count -eq 0) { return $null }
    $byName = @{}
    foreach ($f in $files) { $byName[$f.FullName.Substring($root.Length).Replace('\', '/')] = $f }
    $names = @($byName.Keys)
    [System.Array]::Sort($names, [System.StringComparer]::Ordinal)
    $hasher = [System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $newest = [datetime]::MinValue
    foreach ($name in $names) {
        $file = $byName[$name]
        $line = $name + [char]0 + (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant() + [char]0
        $hasher.AppendData($Utf8.GetBytes($line))
        if ($file.LastWriteTimeUtc -gt $newest) { $newest = $file.LastWriteTimeUtc }
    }
    $hex = ([System.BitConverter]::ToString($hasher.GetHashAndReset()) -replace '-', '').ToLowerInvariant()
    $hasher.Dispose()
    return [ordered]@{ sha256 = $hex; count = $names.Count; newest_mtime_utc = $newest.ToUniversalTime().ToString('o') }
}

function Resolve-SmokeExePath {
    # The one resolution of the smoke build: -SmokeExe, else NQT_SMOKE_EXE, else the default target (the order smoke_real.ps1
    # and the Playwright desktop project use). The record and the launched check both take this path.
    $path = $SmokeExe
    if (-not $path) { $path = [Environment]::GetEnvironmentVariable('NQT_SMOKE_EXE', 'Process') }
    if (-not $path) { $path = 'D:\dev\targets\w5a-app-smoke\release\nq-lab-terminal.exe' }
    return $path
}

function Get-SmokeExeInfo {
    # The smoke build the checks launch, its path and sha256, or $null when there is none.
    $path = Resolve-SmokeExePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    return [ordered]@{ path = $path; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() }
}

function Get-CheckInputs {
    # What a check reads that the tree stamp does not cover (git-ignored or built elsewhere): the smoke exe and web\dist
    # (crosscheck.served and smoke-app), the QA dump folder (crosscheck --strict). Other checks have none.
    param([string]$Name)
    $dist = if ($DistDir) { $DistDir } else { Join-Path $Terminal 'web\dist' }
    $dumps = if ($DumpsDir) { $DumpsDir } elseif ($env:NQT_QA_DUMP_DIR) { $env:NQT_QA_DUMP_DIR } else { Join-Path $Terminal 'qa\.dumps' }
    $out = [ordered]@{}
    if ($Name -in 'crosscheck', 'smoke-app') { $out['smoke_exe'] = Get-SmokeExeInfo; $out['web_dist'] = Get-TreeHash $dist }
    if ($Name -eq 'crosscheck') { $out['dumps'] = Get-TreeHash $dumps '*.json' }
    return $out
}

function Write-Record {
    param([string]$Dir, [string]$Name, [hashtable]$Result, $Stamped, [string]$CommandText, [bool]$SelfTest, $CheckInputs = $null, [string]$StartedUtc = '')
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    $date = (Get-Date).ToString('yyyy-MM-dd')
    $record = [ordered]@{
        check = $Name
        date = $date
        started_utc = $StartedUtc
        finished_utc = (Get-Date).ToUniversalTime().ToString('o')
        pc = $env:COMPUTERNAME
        exit_code = $Result.code
        counts = (Read-Counts $Name $Result.lines)
        command = $CommandText
        self_test = $SelfTest
        stamp = $Stamped
        inputs = $CheckInputs
    }
    $file = Join-Path $Dir "${date}_$Name.json"
    [System.IO.File]::WriteAllText($file, (($record | ConvertTo-Json -Depth 6) + "`n"), $Utf8)
    return $file
}

if ($Stamp) {
    Write-Output ((Get-ProvenanceStamp $StampRoot) | ConvertTo-Json)
    exit 0
}
if ($Inputs) {
    # What release_check.ps1 compares a record's inputs with: the superset (smoke exe, web\dist, dumps) as JSON.
    Write-Output ((Get-CheckInputs 'crosscheck') | ConvertTo-Json -Depth 4)
    exit 0
}
if (-not $Check) { Write-Error 'give -Check backend|crosscheck|smoke|smoke-app, or -Stamp or -Inputs'; exit 2 }

$labDir = Resolve-Lab $Lab
# Any lab other than the parent of terminal runs another venv's python (a stub, an older checkout): a hook as well.
$ownLab = (Split-Path $Terminal -Parent).TrimEnd('\')
$otherLab = -not ([System.IO.Path]::GetFullPath($labDir).TrimEnd('\') -ieq $ownLab)
$selfTest = [bool]($Exe -or $TreeRoot -or $otherLab)
if ($selfTest -and -not $RecordsDir) {
    # A self-test hook must never write where release_check.ps1 reads its records.
    Write-Host 'record_green: -Exe, -TreeRoot and a lab other than the parent of terminal (-Lab, NQT_LAB) are self-test hooks and need an explicit -RecordsDir; nothing was run or written.'
    exit 2
}
if (-not $RecordsDir) { $RecordsDir = Join-Path $Terminal 'state\release' }
$canonical = Get-CheckCommand $Check $labDir
$command = if ($Exe) { @{ exe = $Exe; args = $ExeArgs; cwd = $Terminal } } else { $canonical }
# The record always names the check's own command (what a real run executes), never the hook program.
$commandText = Format-CommandText $canonical
Write-Host "record_green: $Check in $($command.cwd): $(Format-CommandText $command)"

$before = Get-ProvenanceStamp $StampRoot
$inputsBefore = Get-CheckInputs $Check
$startedUtc = (Get-Date).ToUniversalTime().ToString('o')
$result = Invoke-Check $command
$after = Get-ProvenanceStamp $StampRoot
$inputsAfter = Get-CheckInputs $Check
if ($result.code -ne 0) {
    Write-Host "record_green: $Check FAILED with exit code $($result.code); no record written."
    exit 1
}
if (-not (Test-SameStamp $before $after)) {
    Write-Host "record_green: the tree changed while $Check ran (stamp before and after differ); no record written."
    exit 1
}
if (($inputsBefore | ConvertTo-Json -Depth 4 -Compress) -ne ($inputsAfter | ConvertTo-Json -Depth 4 -Compress)) {
    Write-Host "record_green: the smoke exe, web\dist or the dumps changed while $Check ran (inputs before and after differ); no record written."
    exit 1
}
$file = Write-Record $RecordsDir $Check $result $after $commandText $selfTest $inputsAfter $startedUtc
Write-Host "record_green: $Check passed; record $file"
exit 0
