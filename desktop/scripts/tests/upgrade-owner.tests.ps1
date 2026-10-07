<#
.SYNOPSIS
  Tests of desktop\scripts\upgrade-owner.ps1 (REL-01).

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\tests\upgrade-owner.tests.ps1

  1. upgrade-owner.ps1 -SelfTest (fake registry roots and folders under D:\dev\tmp, fake installers) exits 0 with
     0 failed checks.
  2. Called with no installer it prints its usage and exits 2.
  3. The snapshot this file uses is born failing: a changed file, a changed registry value and a changed DACL on a
     scratch folder and a scratch HKCU key each change it.
  4. A default dry run against the real install (no -Go) changes nothing: the values of the product's two HKCU keys,
     every file of the install folder (path, size, SHA256, last write time), the folder's DACL and the list of the backup
     folder are the same before and after. The real install is only read; -Go is never passed. With no install of the
     product for this user the step is skipped and says so. The two installers are read, not pinned: the new one is this
     tree's version from desktop\src-tauri\tauri.conf.json (the newest published release below it when that version is not
     published yet) and the rollback one is the published release before it, from D:\dev\release (born failing with fake
     release folders: version order, release builds only, no pair when there is no earlier release).
  It waits while D:\dev\locks\QUIET_MEASURE exists (a quiet measurement window), polling every 120 s.
#>
[CmdletBinding()]
param(
    [string]$NewInstaller = '',
    [string]$RollbackInstaller = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Script = Join-Path (Split-Path $PSScriptRoot -Parent) 'upgrade-owner.ps1'
$QuietLock = 'D:\dev\locks\QUIET_MEASURE'
$QuietPollSec = 120
$Product = 'nq-lab terminal'
$UninstallKey = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Product"
$FolderKey = "Registry::HKEY_CURRENT_USER\Software\nqlab\$Product"
$BackupRoot = 'D:\dev\backup'
$ReleaseRoot = 'D:\dev\release'
$TreeConf = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'src-tauri\tauri.conf.json'
$Scratch = 'D:\dev\tmp'
$Results = New-Object System.Collections.Generic.List[object]

function Add-Result {
    param([string]$Name, [bool]$Passed, [string]$Detail = '')
    $Results.Add([pscustomobject]@{ name = $Name; passed = $Passed })
    Write-Host ("{0}  {1}{2}" -f $(if ($Passed) { 'PASS' } else { 'FAIL' }), $Name, $(if ($Detail) { "  ($Detail)" } else { '' }))
}

function Invoke-Script {
    param([string[]]$Arguments)
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments 2>&1 | ForEach-Object { "$_" }
    return @{ code = $LASTEXITCODE; text = ($output -join "`n") }
}

function Get-KeySnapshot {
    param([string]$Key)
    if (-not (Test-Path -LiteralPath $Key)) { return "$Key absent" }
    $item = Get-Item -LiteralPath $Key
    $values = foreach ($name in @($item.GetValueNames() | Sort-Object)) { "$name=$($item.GetValue($name, $null, 'DoNotExpandEnvironmentNames'))|$($item.GetValueKind($name))" }
    return "$Key`n$($values -join "`n")`nsubkeys: $(@($item.GetSubKeyNames() | Sort-Object) -join ',')"
}

function Get-FolderSnapshot {
    # Every file and folder (path, size, SHA256, last write time) and the folder's DACL. Files are opened with every share flag.
    param([string]$Folder)
    if (-not (Test-Path -LiteralPath $Folder)) { return "$Folder absent" }
    $lines = foreach ($item in @(Get-ChildItem -LiteralPath $Folder -Recurse -Force | Sort-Object FullName)) {
        if ($item.PSIsContainer) { "$($item.FullName)|dir|$($item.LastWriteTimeUtc.Ticks)"; continue }
        $stream = [System.IO.File]::Open($item.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]'ReadWrite, Delete')
        try { $sha = [System.Security.Cryptography.SHA256]::Create(); $hash = [BitConverter]::ToString($sha.ComputeHash($stream)) } finally { $stream.Dispose() }
        "$($item.FullName)|$($item.Length)|$hash|$($item.LastWriteTimeUtc.Ticks)"
    }
    return "$((Get-Acl -LiteralPath $Folder).Sddl)`n$($lines -join "`n")"
}

function Get-Snapshot {
    param([string[]]$Keys, [string]$Folder, [string]$Listing)
    $keys = @($Keys | ForEach-Object { Get-KeySnapshot $_ })
    $list = if (Test-Path -LiteralPath $Listing) { @(Get-ChildItem -LiteralPath $Listing -Force | Sort-Object Name | ForEach-Object { $_.Name }) -join ',' } else { 'absent' }
    return (@($keys) + @((Get-FolderSnapshot $Folder), "listing: $list")) -join "`n"
}

function Wait-Quiet {
    while (Test-Path -LiteralPath $QuietLock) {
        Write-Host "WAIT  $QuietLock exists (a quiet measurement window); next look in $QuietPollSec s"
        Start-Sleep -Seconds $QuietPollSec
    }
}

function Test-SelfTest {
    $run = Invoke-Script @('-SelfTest')
    $summary = [regex]::Match($run.text, 'upgrade-owner self-test: (\d+) checks, (\d+) failed')
    $ok = ($run.code -eq 0) -and $summary.Success -and ($summary.Groups[2].Value -eq '0')
    Add-Result 'upgrade-owner.ps1 -SelfTest passes' $ok "exit $($run.code); $($summary.Value)"
    if (-not $ok) { Write-Host $run.text }
}

function Test-Usage {
    $run = Invoke-Script @()
    Add-Result 'no installer given: usage and exit code 2' (($run.code -eq 2) -and ($run.text -like '*-Installer*')) "exit $($run.code)"
}

function Test-StateFolderRefusal {
    # A state folder that is not the app's (lab in the config folder's settings.json) is refused before anything is read.
    $id = [guid]::NewGuid().ToString('N').Substring(0, 12)
    $folder = Join-Path $Scratch "upgrade-owner-tests-$id"
    $savedEnv = $env:NQT_STATE_DIR
    try {
        $config = Join-Path $folder 'cfg'
        New-Item -ItemType Directory -Force -Path $config | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $config 'settings.json'), ('{{"lab":{0}}}' -f (ConvertTo-Json (Join-Path $folder 'lab'))) + "`n")
        $common = @('-Installer', (Join-Path $folder 'new_0.1.2_x64-setup.exe'), '-RollbackInstaller', (Join-Path $folder 'old_0.1.1_x64-setup.exe'), '-ConfigDir', $config)
        $run = Invoke-Script ($common + @('-StateDir', (Join-Path $folder 'elsewhere')))
        Add-Result 'a -StateDir that is not the app one is refused with exit 1 (born failing)' (($run.code -eq 1) -and ($run.text -like '*not the one the app uses*')) "exit $($run.code)"
        $env:NQT_STATE_DIR = Join-Path $folder 'leftover'
        $run = Invoke-Script $common
        Add-Result 'a leftover NQT_STATE_DIR that is not the app one is refused with exit 1 (born failing)' (($run.code -eq 1) -and ($run.text -like '*NQT_STATE_DIR*not the one the app uses*')) "exit $($run.code)"
    } finally {
        $env:NQT_STATE_DIR = $savedEnv
        if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
    }
}

function Test-SnapshotBornFailing {
    $id = [guid]::NewGuid().ToString('N').Substring(0, 12)
    $folder = Join-Path $Scratch "upgrade-owner-tests-$id"
    $key = "Registry::HKEY_CURRENT_USER\Software\nqt-upgrade-tests-$id"
    try {
        New-Item -ItemType Directory -Force -Path (Join-Path $folder 'app') | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $folder 'app\a.exe'), "one`n")
        New-Item -Path $key -Force | Out-Null
        Set-ItemProperty -LiteralPath $key -Name 'DisplayVersion' -Value '0.1.1'
        $snap = { Get-Snapshot @($key) (Join-Path $folder 'app') $folder }
        $before = & $snap
        Add-Result 'snapshot is stable when nothing changes' ($before -eq (& $snap))
        Set-ItemProperty -LiteralPath $key -Name 'DisplayVersion' -Value '0.1.2'
        $afterKey = & $snap
        Add-Result 'snapshot sees a changed registry value (born failing)' ($before -ne $afterKey)
        [System.IO.File]::WriteAllText((Join-Path $folder 'app\a.exe'), "two`n")
        $afterFile = & $snap
        Add-Result 'snapshot sees a changed file (born failing)' ($afterKey -ne $afterFile)
        & (Join-Path $env:SystemRoot 'System32\icacls.exe') (Join-Path $folder 'app') /grant '*S-1-5-11:(OI)(CI)M' /Q | Out-Null
        $afterAcl = & $snap
        Add-Result 'snapshot sees a changed DACL (born failing)' ($afterFile -ne $afterAcl)
        New-Item -ItemType Directory -Path (Join-Path $folder 'nqt-0.1.1-new') | Out-Null
        Add-Result 'snapshot sees a new backup folder (born failing)' ($afterAcl -ne (& $snap))
    } finally {
        if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force }
        if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
    }
}

function Get-TreeVersion {
    # The version this tree is built as: the version of desktop\src-tauri\tauri.conf.json.
    param([string]$ConfPath)
    return "$((Get-Content -LiteralPath $ConfPath -Raw | ConvertFrom-Json).version)"
}

function Get-ReleasePair {
    # The two installers of the real dry run: Current is this tree's version (or, when that version is not published
    # yet, the newest published one below it) and Previous is the published release before Current. A release is a folder
    # named as a version under $ReleaseRoot that holds the product's own setup exe (not the measure or installtest build).
    param([string]$ReleaseRoot, [string]$Product, [string]$TreeVersion)
    $published = @()
    foreach ($dir in @(Get-ChildItem -LiteralPath $ReleaseRoot -Directory -ErrorAction SilentlyContinue)) {
        $version = $null
        if (-not [version]::TryParse($dir.Name, [ref]$version)) { continue }
        $installer = Join-Path $dir.FullName "${Product}_$($dir.Name)_x64-setup.exe"
        if (Test-Path -LiteralPath $installer -PathType Leaf) { $published += [pscustomobject]@{ Version = $version; Name = $dir.Name; Installer = $installer } }
    }
    $published = @($published | Sort-Object Version)
    $tree = $null
    if (-not [version]::TryParse($TreeVersion, [ref]$tree)) { $tree = [version]'0.0.0' }
    $current = $published | Where-Object { $_.Version -le $tree } | Select-Object -Last 1
    $previous = if ($current) { $published | Where-Object { $_.Version -lt $current.Version } | Select-Object -Last 1 } else { $null }
    return [pscustomobject]@{ Current = $current; Previous = $previous }
}

function Test-ReleasePairFromFakeVersions {
    # Born failing: the dry run's two installers were pinned to 0.1.2 (new) and 0.1.1 (rollback); they are now read from the
    # published releases and the version of this tree. Fake release folders only; the real D:\dev\release is not read here.
    $id = [guid]::NewGuid().ToString('N').Substring(0, 12)
    $root = Join-Path $Scratch "upgrade-owner-pair-$id"
    $make = {
        param([string]$Name, [string]$Version, [bool]$WithInstaller = $true, [string[]]$Others = @())
        $dir = Join-Path $root $Name
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        if ($WithInstaller) { [System.IO.File]::WriteAllText((Join-Path $dir "${Product}_${Version}_x64-setup.exe"), "fake $Version`n") }
        foreach ($other in $Others) { [System.IO.File]::WriteAllText((Join-Path $dir "$Product ${other}_${Version}_x64-setup.exe"), "fake $other $Version`n") }
    }
    try {
        & $make '0.1.1' '0.1.1' $true @('measure')
        & $make '0.1.2' '0.1.2' $true @('measure', 'installtest')
        & $make '0.9.0' '0.9.0'
        & $make '0.10.0' '0.10.0' $true @('measure')
        & $make '0.11.0' '0.11.0' $false
        & $make 'dec1-acl' '0.0.0' $false
        $pair = Get-ReleasePair -ReleaseRoot $root -Product $Product -TreeVersion '0.10.0'
        Add-Result 'the pair is this tree version and the published one before it, ordered as versions (0.10.0 after 0.9.0)' (($pair.Current.Name -eq '0.10.0') -and ($pair.Previous.Name -eq '0.9.0')) "current $($pair.Current.Name), previous $($pair.Previous.Name)"
        Add-Result 'the installers are the release ones, never the measure or installtest builds' (($pair.Current.Installer -like "*\${Product}_0.10.0_x64-setup.exe") -and ($pair.Previous.Installer -like "*\${Product}_0.9.0_x64-setup.exe")) "$($pair.Current.Installer)"
        $ahead = Get-ReleasePair -ReleaseRoot $root -Product $Product -TreeVersion '0.12.0'
        Add-Result 'a tree version that is not published yet (or has no installer) falls back to the newest published one' (($ahead.Current.Name -eq '0.10.0') -and ($ahead.Previous.Name -eq '0.9.0')) "current $($ahead.Current.Name), previous $($ahead.Previous.Name)"
        $first = Get-ReleasePair -ReleaseRoot $root -Product $Product -TreeVersion '0.1.1'
        Add-Result 'the first published release has no previous one, so there is no pair to dry-run' (($first.Current.Name -eq '0.1.1') -and ($null -eq $first.Previous)) "current $($first.Current.Name)"
        $old = Get-ReleasePair -ReleaseRoot $root -Product $Product -TreeVersion '0.0.1'
        Add-Result 'a tree version older than every release has no current release' (($null -eq $old.Current) -and ($null -eq $old.Previous))
        $none = Get-ReleasePair -ReleaseRoot (Join-Path $root 'absent') -Product $Product -TreeVersion '0.1.1'
        Add-Result 'a missing release folder gives no pair and no error' (($null -eq $none.Current) -and ($null -eq $none.Previous))
        $conf = Join-Path $root 'tauri.conf.json'
        [System.IO.File]::WriteAllText($conf, '{ "productName": "x", "version": "7.8.9" }' + "`n")
        Add-Result 'the version of this tree is read from tauri.conf.json' ((Get-TreeVersion $conf) -eq '7.8.9')
        Add-Result 'the real tauri.conf.json of this tree has a version' ((Get-TreeVersion $TreeConf) -match '^\d+\.\d+\.\d+$') "$(Get-TreeVersion $TreeConf)"
    } finally {
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    }
}

function Test-RealDryRun {
    if (-not (Test-Path -LiteralPath $UninstallKey)) { Write-Host "SKIP  real dry run: no install of '$Product' for this user"; return }
    $location = "$((Get-ItemProperty -LiteralPath $UninstallKey).InstallLocation)".Trim().Trim('"')
    # The new installer is this tree's version (or the newest published one below it) and the rollback installer is the
    # published release before it; -NewInstaller and -RollbackInstaller still override either.
    $pair = Get-ReleasePair -ReleaseRoot $ReleaseRoot -Product $Product -TreeVersion (Get-TreeVersion $TreeConf)
    $new = if ($NewInstaller) { $NewInstaller } elseif ($pair.Current) { $pair.Current.Installer } else { '' }
    $rollback = if ($RollbackInstaller) { $RollbackInstaller } elseif ($pair.Previous) { $pair.Previous.Installer } else { '' }
    if (-not $new -or -not $rollback) { Write-Host "SKIP  real dry run: fewer than two published releases under $ReleaseRoot for this tree's version and none given"; return }
    $before = Get-Snapshot @($UninstallKey, $FolderKey) $location $BackupRoot
    $run = Invoke-Script @('-Installer', $new, '-RollbackInstaller', $rollback)
    $after = Get-Snapshot @($UninstallKey, $FolderKey) $location $BackupRoot
    Add-Result 'a default dry run against the real install prints a dry-run plan' (($run.text -like '*DRY RUN*') -and ($run.code -in 0, 1)) "exit $($run.code); new installer $new; rollback installer $rollback"
    Add-Result 'a default dry run changes nothing (HKCU key values, install folder files and DACL, backup folder list)' ($before -eq $after) "install folder $location"
    $outcome = [regex]::Match($run.text, '(?m)^(dry run: every check passed|refused: nothing was changed|upgraded |the upgrade failed)')
    Add-Result 'a default dry run ends with a dry-run or refused outcome, never an upgrade' ($outcome.Success -and $outcome.Value -cmatch '^(dry run|refused)') "outcome '$($outcome.Value)'"
    Write-Host ($run.text -split "`n" | Where-Object { $_ -match 'REFUSE|dry run|refused' } | ForEach-Object { "NOTE  $_" }) -Separator "`n"
}

Wait-Quiet
Test-SelfTest
Test-Usage
Test-StateFolderRefusal
Test-SnapshotBornFailing
Test-ReleasePairFromFakeVersions
Test-RealDryRun
$failed = @($Results | Where-Object { -not $_.passed })
Write-Host ("upgrade-owner tests: {0} checks, {1} failed" -f $Results.Count, $failed.Count)
if ($failed.Count -gt 0) { exit 1 }
exit 0
