<#
.SYNOPSIS
  Moves every place the desktop build's version lives to one new X.Y.Z, and checks they agree afterwards (AUD-2).

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\bump-version.ps1 -Version 0.1.2 [-DryRun] [-Root <terminal folder>]
  powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\bump-version.ps1 -List [-Root <terminal folder>]

  The one source of the current version is desktop\src-tauri\tauri.conf.json. Before anything is written every place
  must carry that same version (a place that disagrees stops the run, naming it), so a half-edited tree is never
  made worse. The places:
    desktop\src-tauri\tauri.conf.json, tauri.measure.conf.json, tauri.smoke.conf.json and any other
      tauri.<name>.conf.json that has a top-level "version"        the "version" line
    desktop\src-tauri\Cargo.toml                                   [package] version
    desktop\src-tauri\Cargo.lock                                   the nq-lab-terminal entry
    backend\nq_terminal\__init__.py                                __version__
    contract\openapi.json                                          info.version
    desktop\scripts\build-release.ps1, desktop\scripts\install-test.ps1, scripts\release_check.ps1
                                                                   the usage lines of the header comment
                                                                   (-Version X, desktop-vX, release\X, _X_x64-setup)
  Derived, rewritten from the new contract so that `pnpm check:api` stays green (gen-api.mjs hashes the contract
  with CRLF normalised to LF): web\src\api\openapi.sha256 and the first line of web\src\api\schema.d.ts.

  Files keep their line endings and any byte order mark; nothing is written when any place cannot be handled, and
  the written files are read back and compared. -DryRun prints what would change and writes nothing. -List prints
  the managed paths, relative to the terminal folder, one per line. Historical mentions of an earlier version (the
  documents about a published release, a comment about the release that introduced something) are not places and
  are never touched. web\dist is not rebuilt here: run `pnpm build` after the bump.
.PARAMETER Version
  The new version, X.Y.Z.
.PARAMETER Root
  The terminal folder (default: the one above desktop\scripts). The self-test points it at a copy.
#>
[CmdletBinding(DefaultParameterSetName = 'Bump')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Bump')]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [Parameter(ParameterSetName = 'Bump')]
    [switch]$DryRun,
    [Parameter(Mandatory = $true, ParameterSetName = 'List')]
    [switch]$List,
    [string]$Root = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Join-Path $PSScriptRoot '..\..' }
$Root = (Resolve-Path -LiteralPath $Root).Path
$Crate = 'desktop/src-tauri'
$PrimaryPath = "$Crate/tauri.conf.json"
$VersionToken = '\d+\.\d+\.\d+'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

# Each kind: a regex whose group 1 is what precedes the version, group 2 the version, and group 3 what follows.
$Patterns = @{
    'json-version' = @('(?m)^(  "version"\s*:\s*")(' + $VersionToken + ')(")')
    'toml-package' = @('(?ms)(^\[package\][^\[]*?^version\s*=\s*")(' + $VersionToken + ')(")')
    'lock-app'     = @('(?m)(^name = "nq-lab-terminal"\r?\nversion = ")(' + $VersionToken + ')(")')
    'py-version'   = @('(?m)(^__version__\s*=\s*")(' + $VersionToken + ')(")')
    'openapi'      = @('("info"\s*:\s*\{[^{}]*?"version"\s*:\s*")(' + $VersionToken + ')(")')
    'script-header' = @(
        ('(-Version )(' + $VersionToken + ')()'),
        ('(desktop-v)(' + $VersionToken + ')()'),
        ('(release\\)(' + $VersionToken + ')()'),
        ('(_)(' + $VersionToken + ')(_x64-setup)')
    )
}

function Get-Places {
    $places = New-Object System.Collections.Generic.List[object]
    $add = { param($path, $kind, $optional) $places.Add([pscustomobject]@{ Path = $path; Kind = $kind; Optional = [bool]$optional }) }
    & $add $PrimaryPath 'json-version' $false
    foreach ($name in 'tauri.measure.conf.json', 'tauri.smoke.conf.json') { & $add "$Crate/$name" 'json-version' $false }
    $others = Get-ChildItem -LiteralPath (Join-Path $Root $Crate) -Filter 'tauri.*.conf.json' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin 'tauri.measure.conf.json', 'tauri.smoke.conf.json' } | Sort-Object Name
    foreach ($file in $others) { & $add "$Crate/$($file.Name)" 'json-version' $true }
    & $add "$Crate/Cargo.toml" 'toml-package' $false
    & $add "$Crate/Cargo.lock" 'lock-app' $false
    & $add 'backend/nq_terminal/__init__.py' 'py-version' $false
    & $add 'contract/openapi.json' 'openapi' $false
    foreach ($path in 'desktop/scripts/build-release.ps1', 'desktop/scripts/install-test.ps1', 'scripts/release_check.ps1') { & $add $path 'script-header' $false }
    & $add 'web/src/api/openapi.sha256' 'contract-hash' $true
    & $add 'web/src/api/schema.d.ts' 'contract-hash' $true
    return $places
}

function Read-Text {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $skip = if ($bom) { 3 } else { 0 }
    $text = $Utf8.GetString($bytes, $skip, $bytes.Length - $skip)
    return [pscustomobject]@{ Text = $text; Bom = $bom }
}

function Write-Text {
    param([string]$Path, [string]$Text, [bool]$Bom)
    $body = $Utf8.GetBytes($Text)
    $bytes = if ($Bom) { [byte[]](@(0xEF, 0xBB, 0xBF) + $body) } else { $body }
    [System.IO.File]::WriteAllBytes($Path, $bytes)
}

function Get-Scope {
    # The part of the text that carries the version: the whole file, or the header comment of a script.
    param([string]$Kind, [string]$Text)
    if ($Kind -ne 'script-header') { return $Text.Length }
    $m = [regex]::Match($Text, '(?m)^(\[CmdletBinding|param\()')
    if ($m.Success) { return $m.Index } else { return [Math]::Min($Text.Length, 4000) }
}

function Get-Versions {
    # Every version this place states (a list; empty when the place states none).
    param($Place, [string]$Text)
    $scope = $Text.Substring(0, (Get-Scope $Place.Kind $Text))
    $found = New-Object System.Collections.Generic.List[string]
    foreach ($pattern in $Patterns[$Place.Kind]) {
        $hits = [regex]::Matches($scope, $pattern)
        if ($Place.Kind -ne 'script-header' -and $hits.Count -gt 0) { $hits = @($hits[0]) }
        foreach ($m in $hits) { $found.Add($m.Groups[2].Value) }
    }
    return $found.ToArray()
}

function Set-Versions {
    param($Place, [string]$Text, [string]$New)
    $length = Get-Scope $Place.Kind $Text
    $scope = $Text.Substring(0, $length)
    foreach ($pattern in $Patterns[$Place.Kind]) {
        $count = if ($Place.Kind -eq 'script-header') { -1 } else { 1 }
        $scope = ([regex]$pattern).Replace($scope, { param($m) $m.Groups[1].Value + $New + $m.Groups[3].Value }, $count)
    }
    return $scope + $Text.Substring($length)
}

function Get-ContractHash {
    $text = (Read-Text (Join-Path $Root 'contract/openapi.json')).Text -replace "`r`n", "`n"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return (($sha.ComputeHash($Utf8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Set-ContractHash {
    param($Place, [string]$Text, [string]$Hash)
    if ($Place.Path -like '*.sha256') { return "$Hash`n" }
    return [regex]::Replace($Text, '^// contract sha256: [0-9a-f]{64}', "// contract sha256: $Hash")
}

$places = @(Get-Places)
if ($List) {
    foreach ($place in $places) {
        if (Test-Path -LiteralPath (Join-Path $Root $place.Path)) { Write-Output $place.Path }
    }
    return
}

$primary = Read-Text (Join-Path $Root $PrimaryPath)
$current = @(Get-Versions $places[0] $primary.Text)
if ($current.Count -ne 1) { throw "$PrimaryPath names no single version" }
$Old = $current[0]

# Pass 1: read every place and refuse any that disagrees. Nothing is written until all places pass.
$problems = New-Object System.Collections.Generic.List[string]
$plans = New-Object System.Collections.Generic.List[object]
foreach ($place in $places) {
    $full = Join-Path $Root $place.Path
    if (-not (Test-Path -LiteralPath $full)) {
        if (-not $place.Optional) { $problems.Add("$($place.Path): the file is missing") }
        continue
    }
    $file = Read-Text $full
    if ($place.Kind -eq 'contract-hash') { $plans.Add([pscustomobject]@{ Place = $place; File = $file; Full = $full }); continue }
    $versions = @(Get-Versions $place $file.Text)
    if ($versions.Count -eq 0) {
        if (-not $place.Optional) { $problems.Add("$($place.Path): no version found") }
        continue
    }
    $wrong = @($versions | Where-Object { $_ -ne $Old } | Select-Object -Unique)
    if ($wrong.Count -gt 0) { $problems.Add("$($place.Path): says $($wrong -join ', '), not $Old (the version of $PrimaryPath)"); continue }
    $plans.Add([pscustomobject]@{ Place = $place; File = $file; Full = $full })
}
if ($problems.Count -gt 0) {
    $problems | ForEach-Object { Write-Host "bump-version: $_" }
    throw "bump-version: $($problems.Count) places do not agree on $Old; nothing was written"
}
if ($Old -eq $Version) { Write-Host "bump-version: every place is already at $Version, nothing to do"; return }

# Pass 2: compute every new text (the contract first, because the derived files hash it), then write.
$results = New-Object System.Collections.Generic.List[object]
$contractNew = $null
foreach ($plan in ($plans | Sort-Object { if ($_.Place.Kind -eq 'contract-hash') { 1 } else { 0 } })) {
    if ($plan.Place.Kind -eq 'contract-hash') {
        $text = Set-ContractHash $plan.Place $plan.File.Text $contractNew
    } else {
        $text = Set-Versions $plan.Place $plan.File.Text $Version
        if ($plan.Place.Kind -eq 'openapi') {
            $sha = [System.Security.Cryptography.SHA256]::Create()
            $contractNew = (($sha.ComputeHash($Utf8.GetBytes(($text -replace "`r`n", "`n"))) | ForEach-Object { $_.ToString('x2') }) -join '')
        }
    }
    $results.Add([pscustomobject]@{ Plan = $plan; Text = $text; Changed = ($text -ne $plan.File.Text) })
}

foreach ($r in $results) {
    $verb = if ($DryRun) { 'would change' } else { 'changed' }
    if ($r.Changed) { Write-Host "  $verb $($r.Plan.Place.Path)" } else { Write-Host "  unchanged $($r.Plan.Place.Path)" }
}
if ($DryRun) { Write-Host "bump-version: dry run, $Old -> $Version, nothing written"; return }
foreach ($r in $results) {
    if ($r.Changed) { Write-Text $r.Plan.Full $r.Text $r.Plan.File.Bom }
}

# Read back: every place now states the new version, and the derived files match the written contract.
$bad = New-Object System.Collections.Generic.List[string]
foreach ($r in $results) {
    $now = Read-Text $r.Plan.Full
    if ($r.Plan.Place.Kind -eq 'contract-hash') {
        if (-not $now.Text.Contains((Get-ContractHash))) { $bad.Add("$($r.Plan.Place.Path): does not carry the hash of the written contract") }
        continue
    }
    $versions = @(Get-Versions $r.Plan.Place $now.Text)
    if ($versions.Count -eq 0 -or @($versions | Where-Object { $_ -ne $Version }).Count -gt 0) { $bad.Add("$($r.Plan.Place.Path): reads $($versions -join ', ') after the write") }
}
if ($bad.Count -gt 0) {
    $bad | ForEach-Object { Write-Host "bump-version: $_" }
    throw 'bump-version: the read-back disagrees; check the tree with git diff'
}
Write-Host "bump-version: $Old -> $Version in $(@($results | Where-Object { $_.Changed }).Count) files; next: pnpm build in terminal\web, then the release check"
