<#
.SYNOPSIS
  Refuses a release tag unless the day's green records and the artefacts all describe the tree as it is now.

.DESCRIPTION
  powershell -NoProfile -File terminal\scripts\release_check.ps1 -Tag desktop-v0.1.1 [-ReleaseDir D:\dev\release\0.1.1]

  It never creates the tag and never pushes: the owner does that after it passes (04 D5.4; 05 S08, G07).

  It passes only when ALL of these hold, and prints every failure, not just the first:
    - the tag is desktop-vX.Y.Z and does not exist yet;
    - for each of backend, crosscheck and smoke there is terminal\state\release\<today>_<check>.json (written by
      scripts\record_green.ps1, never by hand) that is dated today (this PC's local date), names this PC, has exit
      code 0 and carries a provenance stamp equal to the CURRENT tree's (HEAD, sha256 of `git diff HEAD`, sha256 of
      the untracked files: the stamp of record_green.ps1 -Stamp). A record of the day before, of another PC or of a
      tree that has changed since is refused. smoke-app is listed when present, and required with -RequireSmokeApp;
    - the release folder's PROVENANCE.json (written by desktop\scripts\build-release.ps1) names the same version as
      the tag and carries the same stamp, so the artefacts were built from this very tree;
    - the tree is a clean commit (`git diff HEAD` empty, no untracked file), so the tagged HEAD, printed by the check,
      contains exactly the code the records and the artefacts describe;
    - for crosscheck (and smoke-app with -RequireSmokeApp) the smoke exe the record launched must be the release
      folder's payload/smoke/nq-lab-terminal.exe (same sha256 as PROVENANCE.json lists; point NQT_SMOKE_EXE at that
      exe), and web\dist must hash as it did for the record; for crosscheck the dump folder must hash as it did and
      be newer than the start of the same day's backend run;
    - SHA256SUMS lists every file of the release folder (but itself) and every hash is right;
    - desktop\scripts\artefact-check.mjs passes on the release folder (no lab data, manifests, imports, updater).
.PARAMETER Tag
  The tag the owner wants to push, desktop-vX.Y.Z.
.PARAMETER ReleaseDir
  The release folder (default D:\dev\release\<version>).
.PARAMETER RecordsDir
  Where the records are (default terminal\state\release).
.PARAMETER RequireSmokeApp
  Also require the smoke-app record.
.PARAMETER TreeRoot, Today, Pc, ArtefactCheckScript
  Self-test hooks (scripts\tests\release_check.tests.ps1): another git tree, another date, another PC name, another
  artefact check. A run that uses any of them, or -RecordsDir or -ReleaseDir, says so (WARN) and is not a release
  check. Records written through the hooks of record_green.ps1 carry self_test = true and are refused, as is any
  record whose command is not the named check's own.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,
    [string]$ReleaseDir = '',
    [string]$RecordsDir = '',
    [switch]$RequireSmokeApp,
    [string]$TreeRoot = '',
    [string]$Today = '',
    [string]$Pc = '',
    [string]$ArtefactCheckScript = '',
    [string]$DistDir = '',
    [string]$DumpsDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Terminal = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Failures = New-Object System.Collections.Generic.List[string]
$RequiredChecks = @('backend', 'crosscheck', 'smoke')
# The command text record_green.ps1 writes for each check (04 D5.4: the record must come from the check's own command).
# Compared for exact equality: the lab is the parent of this terminal and the paths are this terminal's own.
$LabRoot = (Split-Path $Terminal -Parent)
$SmokeCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File $Terminal\scripts\smoke_real.ps1"
$CanonicalCommands = @{
    'backend' = "$LabRoot\.venv\Scripts\python.exe -m pytest -p no:warnings -o addopts= -q $Terminal\backend\tests"
    'crosscheck' = "uv run --project $Terminal\qa python -m crosscheck --strict ; then uv run --project $Terminal\qa python -m crosscheck.served"
    'smoke' = $SmokeCommand
    'smoke-app' = "$SmokeCommand -Mode App"
}

function Add-Check {
    param([string]$Name, [bool]$Passed, [string]$Detail)
    $mark = if ($Passed) { 'PASS' } else { 'FAIL' }
    Write-Host ("{0}  {1}  {2}" -f $mark, $Name, $Detail)
    if (-not $Passed) { $Failures.Add("${Name}: $Detail") }
}

function Get-CurrentStamp {
    param([string]$Tree)
    $record = Join-Path $PSScriptRoot 'record_green.ps1'
    $text = & powershell -NoProfile -ExecutionPolicy Bypass -File $record -Stamp -TreeRoot $Tree
    if ($LASTEXITCODE -ne 0) { throw 'record_green.ps1 -Stamp failed' }
    return (($text -join "`n") | ConvertFrom-Json)
}

function Get-CurrentInputs {
    # web\dist and the dump folder as they are now, hashed by record_green.ps1 -Inputs (the code the records use).
    $record = Join-Path $PSScriptRoot 'record_green.ps1'
    $hooks = @()
    if ($DistDir) { $hooks += @('-DistDir', $DistDir) }
    if ($DumpsDir) { $hooks += @('-DumpsDir', $DumpsDir) }
    $text = & powershell -NoProfile -ExecutionPolicy Bypass -File $record -Inputs @hooks
    if ($LASTEXITCODE -ne 0) { throw 'record_green.ps1 -Inputs failed' }
    return (($text -join "`n") | ConvertFrom-Json)
}

function Get-Prop {
    # A property of a parsed JSON object, or $null (a forged or partial record must be refused, not crash the check).
    param($Object, [string]$Name)
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return $Object.PSObject.Properties[$Name].Value }
    return $null
}

function Get-StampDifferences {
    # What differs between two stamps (empty when they are the same tree).
    param($A, $B)
    $out = @()
    foreach ($field in 'head', 'diff_sha256', 'untracked_sha256') {
        $left = Get-Prop $A $field
        $right = Get-Prop $B $field
        if (-not $left -or $left -ne $right) { $out += "$field differs (record $left, tree $right)" }
    }
    return ,@($out)
}

function Get-ProvenanceProblems {
    # A record is only valid when record_green.ps1 ran the check's own command: no self-test hook, no other command.
    param($Record, [string]$Name)
    $out = @()
    if ((Get-Prop $Record 'self_test') -ne $false) { $out += 'the record does not say self_test = false (a self-test record or one written by hand)' }
    $command = Get-Prop $Record 'command'
    if ($command -isnot [string] -or $command -ine $CanonicalCommands[$Name]) { $out += "the record's command is not the command of the $Name check ('$command')" }
    return ,@($out)
}

function Get-RecordProblems {
    # Everything wrong with one record file, as a list.
    param([string]$Path, [string]$Name, $Stamp, [string]$Date, [string]$Computer)
    if (-not (Test-Path -LiteralPath $Path)) { return ,@("no record $Path (run record_green.ps1 -Check $Name today)") }
    try { $record = Get-Content -Raw -Path $Path -Encoding UTF8 | ConvertFrom-Json } catch { return ,@("unreadable record $Path") }
    $out = @()
    if ((Get-Prop $record 'check') -ne $Name) { $out += "the record is for '$(Get-Prop $record 'check')', not $Name" }
    if ((Get-Prop $record 'date') -ne $Date) { $out += "the record is dated $(Get-Prop $record 'date'), not today ($Date)" }
    if ((Get-Prop $record 'pc') -ne $Computer) { $out += "the record is from PC '$(Get-Prop $record 'pc')', not '$Computer'" }
    if ((Get-Prop $record 'exit_code') -ne 0) { $out += "the record's exit code is $(Get-Prop $record 'exit_code')" }
    $out += Get-ProvenanceProblems $record $Name
    $recordStamp = Get-Prop $record 'stamp'
    if ($null -eq $recordStamp) { return ,@($out + 'the record has no provenance stamp') }
    $out += Get-StampDifferences $recordStamp $Stamp
    return ,@($out)
}

function Test-Records {
    param([string]$Dir, $Stamp, [string]$Date, [string]$Computer)
    $checks = @($RequiredChecks)
    if ($RequireSmokeApp) { $checks += 'smoke-app' }
    foreach ($name in $checks) {
        $problems = Get-RecordProblems (Join-Path $Dir "${Date}_$name.json") $name $Stamp $Date $Computer
        $older = @(Get-ChildItem -Path $Dir -Filter "*_$name.json" -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
        $detail = if ($problems.Count -eq 0) { "${Date}_$name.json, same day, same PC, same stamp" } else { ($problems -join '; ') + $(if ($older.Count -gt 0) { " [records present: $($older -join ', ')]" } else { '' }) }
        Add-Check "record $name" ($problems.Count -eq 0) $detail
    }
    if (-not $RequireSmokeApp) {
        $app = Get-RecordProblems (Join-Path $Dir "${Date}_smoke-app.json") 'smoke-app' $Stamp $Date $Computer
        Write-Host ("NOTE  smoke-app record: {0}" -f $(if ($app.Count -eq 0) { 'present and current' } else { 'not current (not required without -RequireSmokeApp)' }))
    }
}

function Test-CleanTree {
    # The tag lands on a commit, so the records and artefacts must describe that commit and nothing beside it:
    # `git diff HEAD` empty (the sha256 of no bytes) and no untracked file.
    param($Stamp)
    $emptySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    $problems = @()
    if ((Get-Prop $Stamp 'diff_sha256') -ne $emptySha256) { $problems += 'tracked files differ from HEAD (git diff HEAD is not empty)' }
    $untracked = Get-Prop $Stamp 'untracked_count'
    if ($null -eq $untracked -or [int]$untracked -ne 0) { $problems += "untracked files present (count $untracked)" }
    $detail = if ($problems.Count -eq 0) { 'git diff HEAD is empty and no untracked file' } else { ($problems -join '; ') + ': commit first, then record and build from the clean commit' }
    Add-Check 'clean tree' ($problems.Count -eq 0) $detail
}

function Test-Provenance {
    param([string]$Dir, $Stamp, [string]$Version)
    $file = Join-Path $Dir 'PROVENANCE.json'
    if (-not (Test-Path -LiteralPath $file)) { Add-Check 'artefact provenance' $false "no $file (run build-release.ps1)"; return }
    $doc = Get-Content -Raw -Path $file -Encoding UTF8 | ConvertFrom-Json
    $problems = @()
    $problems += Get-StampDifferences $doc $Stamp
    if ((Get-Prop $doc 'version') -ne $Version) { $problems += "the artefacts are version $(Get-Prop $doc 'version'), the tag is $Version" }
    $detail = if ($problems.Count -eq 0) { "version $Version, built from this tree" } else { $problems -join '; ' }
    Add-Check 'artefact provenance' ($problems.Count -eq 0) $detail
}

function Get-Instant {
    # A record's time (a string, or a DateTime when the JSON reader converted it) as UTC, or $null.
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [datetime]) { return $Value.ToUniversalTime() }
    $parsed = [datetimeoffset]::MinValue
    if ([datetimeoffset]::TryParse([string]$Value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal, [ref]$parsed)) { return $parsed.UtcDateTime }
    return $null
}

function Get-InputProblems {
    # What is wrong with the inputs one record says it used (smoke exe, web\dist, dumps), against the release folder's
    # smoke payload and the folders as they are now.
    param([string]$Name, $Record, $Backend, $Current, [string]$SmokeSha)
    $recorded = Get-Prop $Record 'inputs'
    if ($null -eq $recorded) { return ,@("the record lists no inputs (smoke exe, web\dist, dumps); run record_green.ps1 -Check $Name again") }
    $out = @()
    $exeSha = Get-Prop (Get-Prop $recorded 'smoke_exe') 'sha256'
    if (-not $exeSha) { $out += 'the record names no smoke exe' }
    elseif (-not $SmokeSha) { $out += 'the release folder lists no payload/smoke/nq-lab-terminal.exe to compare the smoke exe with' }
    elseif ($exeSha -ne $SmokeSha) { $out += "the smoke exe the check launched (sha256 $exeSha) is not the release payload/smoke exe ($SmokeSha); launch the release folder's own exe (NQT_SMOKE_EXE)" }
    $distSha = Get-Prop (Get-Prop $recorded 'web_dist') 'sha256'
    $nowDist = Get-Prop (Get-Prop $Current 'web_dist') 'sha256'
    if (-not $distSha) { $out += 'the record names no web\dist hash' }
    elseif ($distSha -ne $nowDist) { $out += 'web\dist is not the one the check used (sha256 differs); build it and run the check again' }
    if ($Name -ne 'crosscheck') { return ,@($out) }
    $dumps = Get-Prop $recorded 'dumps'
    if (-not (Get-Prop $dumps 'sha256')) { return ,@($out + 'the record names no dumps hash') }
    if ((Get-Prop $dumps 'sha256') -ne (Get-Prop (Get-Prop $Current 'dumps') 'sha256')) { $out += 'the dumps are not the ones the check read (sha256 differs); run the backend test and the check again' }
    $newest = Get-Instant (Get-Prop $dumps 'newest_mtime_utc')
    $started = Get-Instant (Get-Prop $Backend 'started_utc')
    if ($null -eq $started) { $out += 'the backend record has no start time to compare the dumps with' }
    elseif ($null -eq $newest -or $newest -lt $started) { $out += "the dumps are older than the backend run of this stamp (newest $(if ($newest) { $newest.ToString('o') } else { 'unknown' }), backend started $($started.ToString('o')))" }
    return ,@($out)
}

function Test-RecordInputs {
    # The inputs the tree stamp cannot cover: for crosscheck and smoke-app, the smoke exe must be the release payload's,
    # web\dist the one the check used; for crosscheck, the dumps must be the ones read and newer than the backend run.
    param([string]$RecordDir, [string]$ReleaseFolder, [string]$Date, $Current)
    $payload = $null
    $provFile = Join-Path $ReleaseFolder 'PROVENANCE.json'
    if (Test-Path -LiteralPath $provFile) {
        $doc = Get-Content -Raw -Path $provFile -Encoding UTF8 | ConvertFrom-Json
        $entry = @(Get-Prop $doc 'files' | Where-Object { (Get-Prop $_ 'path') -eq 'payload/smoke/nq-lab-terminal.exe' }) | Select-Object -First 1
        $payload = Get-Prop $entry 'sha256'
    }
    $names = @('crosscheck')
    if ($RequireSmokeApp) { $names += 'smoke-app' }
    $read = { param($n) $p = Join-Path $RecordDir "${Date}_$n.json"; if (Test-Path -LiteralPath $p) { try { Get-Content -Raw -Path $p -Encoding UTF8 | ConvertFrom-Json } catch { $null } } }
    $backend = & $read 'backend'
    foreach ($name in $names) {
        $record = & $read $name
        if ($null -eq $record) { continue }   # a missing record is already refused by Test-Records
        $problems = Get-InputProblems $name $record $backend $Current $payload
        Add-Check "record inputs $name" ($problems.Count -eq 0) $(if ($problems.Count -eq 0) { 'smoke exe is the release payload, web\dist and dumps are those the check used' } else { $problems -join '; ' })
    }
}

function Test-Checksums {
    param([string]$Dir)
    $file = Join-Path $Dir 'SHA256SUMS'
    if (-not (Test-Path -LiteralPath $file)) { Add-Check 'SHA256SUMS' $false "no $file"; return }
    $listed = @{}
    foreach ($line in (Get-Content -Path $file -Encoding UTF8)) {
        if ($line -match '^([0-9a-fA-F]{64}) \*(.+)$') { $listed[$Matches[2]] = $Matches[1].ToLowerInvariant() }
    }
    $problems = @()
    $prefix = (Resolve-Path -LiteralPath $Dir).Path.TrimEnd('\') + '\'
    foreach ($f in Get-ChildItem -Path $Dir -Recurse -File) {
        $relative = $f.FullName.Substring($prefix.Length).Replace('\', '/')
        if ($relative -eq 'SHA256SUMS') { continue }
        if (-not $listed.ContainsKey($relative)) { $problems += "$relative is not listed"; continue }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.ToLowerInvariant() -ne $listed[$relative]) { $problems += "$relative does not match its hash" }
    }
    foreach ($name in $listed.Keys) { if (-not (Test-Path -LiteralPath (Join-Path $Dir $name))) { $problems += "$name is listed but missing" } }
    $detail = if ($problems.Count -eq 0) { "$($listed.Count) files, every hash right" } else { $problems -join '; ' }
    Add-Check 'SHA256SUMS' ($problems.Count -eq 0) $detail
}

function Test-Artefacts {
    param([string]$Dir, [string]$Script)
    $ErrorActionPreference = 'Continue'
    $output = & node $Script $Dir 2>&1 | ForEach-Object { $_.ToString() }
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Add-Check 'artefact check' ($code -eq 0) (($output | Select-Object -Last 3) -join ' | ')
}

function Test-TagName {
    param([string]$Name, [string]$Tree)
    $parsed = [regex]::Match($Name, '^desktop-v(\d+\.\d+\.\d+)$')
    if (-not $parsed.Success) { Add-Check 'tag name' $false "'$Name' is not desktop-vX.Y.Z"; return $null }
    $version = $parsed.Groups[1].Value
    $existing = @(& git -C $Tree tag -l $Name)
    Add-Check 'tag name' ($existing.Count -eq 0) $(if ($existing.Count -eq 0) { "$Name is free (this script never creates it)" } else { "$Name already exists" })
    return $version
}

$tree = if ($TreeRoot) { $TreeRoot } else { $Terminal }
$date = if ($Today) { $Today } else { (Get-Date).ToString('yyyy-MM-dd') }
$computer = if ($Pc) { $Pc } else { $env:COMPUTERNAME }
$recordsDir = if ($RecordsDir) { $RecordsDir } else { Join-Path $Terminal 'state\release' }
$artefactScript = if ($ArtefactCheckScript) { $ArtefactCheckScript } else { Join-Path $Terminal 'desktop\scripts\artefact-check.mjs' }
$hooksUsed = @(foreach ($hook in 'TreeRoot', 'Today', 'Pc', 'ArtefactCheckScript', 'RecordsDir', 'ReleaseDir') { if ($PSBoundParameters.ContainsKey($hook)) { $hook } })
if ($hooksUsed.Count -gt 0) { Write-Host "WARN  a self-test hook is in use ($($hooksUsed -join ', ')): this is not a release check" }

$version = Test-TagName $Tag $tree
if ($version) {
    if (-not $ReleaseDir) { $ReleaseDir = Join-Path 'D:\dev\release' $version }
    $stamp = Get-CurrentStamp $tree
    Write-Host "release_check: $Tag, tree HEAD $($stamp.head), date $date, PC $computer, records $recordsDir, artefacts $ReleaseDir"
    Write-Host "HEAD to be tagged: $($stamp.head)"
    Test-CleanTree $stamp
    Test-Records $recordsDir $stamp $date $computer
    Test-Provenance $ReleaseDir $stamp $version
    Test-RecordInputs $recordsDir $ReleaseDir $date (Get-CurrentInputs)
    if (Test-Path -LiteralPath $ReleaseDir) { Test-Checksums $ReleaseDir; Test-Artefacts $ReleaseDir $artefactScript }
}

Write-Host ''
if ($Failures.Count -gt 0) {
    Write-Host "release_check: REFUSED $Tag ($($Failures.Count) problems)"
    exit 1
}
Write-Host "release_check: $Tag may be tagged by the owner (git tag $Tag; this script did not create it)"
exit 0
