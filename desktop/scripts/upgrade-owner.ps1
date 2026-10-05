<#
.SYNOPSIS
  The owner's upgrade of the installed desktop app, with a backup, a verify step and a rollback (REL-01).

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\upgrade-owner.ps1 -Installer <new setup exe> -RollbackInstaller <old setup exe>
  powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\upgrade-owner.ps1 -Installer <new setup exe> -RollbackInstaller <old setup exe> -Go
  powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\upgrade-owner.ps1 -SelfTest

  The state folder is the one the app uses: <lab>\terminal\state, with lab read from <config folder>\settings.json (or
  settings.json.1). The plan prints where it came from. A -StateDir or an NQT_STATE_DIR (a smoke run may leave one set)
  that names another folder is refused unless -AllowStateOverride is given.

  Without -Go it is a dry run: it reads the install and the folders, runs every check -Go would run, prints the plan and
  changes nothing (no folder, file or registry value is written). With -Go:
    1. Preflight, refusing on any problem: the product is installed for this user (HKCU uninstall entry) and the folder the
       installer remembers is its InstallLocation; no process runs from that folder or under the app's name, and no
       backend of the lab is alive (the pid in terminal\state\backend.lock; every door must be closed, the browser door
       too); the new installer is this product's release installer (not a measure or smoke build) and its SHA256 equals
       -Sha256 or the line of SHA256SUMS beside it (the published release names spaces as dots); the rollback installer
       exists, passes the same hash check and is the installed version; free space on the install and backup drives.
    2. Backup to <BackupRoot>\nqt-<installed version>-<time>: a copy of the install folder, the state folder (never
       backend.lock, which holds a session secret) and the app's config folder (%APPDATA%\<identifier>), the two HKCU
       keys as registry.json, and manifest.json with the size and SHA256 of every file; every copy is hashed again.
    3. The new installer runs silently for the current user with '/S /NS' and no /D=, so it installs into the remembered
       folder and adds no shortcut. It is started hidden, without the shell, with TEMP on D:.
    4. Verify: exit code 0; DisplayVersion is the new version; InstallLocation and the remembered folder are unchanged;
       the install folder's DACL is the one of hand-over section 6 (inheritance removed, exactly the current user, SYSTEM
       and Administrators, nothing inherited, no broad writer on the files); the app was not started; no new shortcut;
       the state and config files hash exactly as in the manifest.
    5. On any failed verify, roll back and say so: when the install changed, the new version's uninstaller runs silently
       (app data kept) and the rollback installer is installed with '/S /NS /D=<same folder>' and verified the same way;
       state and config files that differ from the manifest are copied back from the backup and hashed again.
  It never starts the app: the owner makes the first launch. The report goes to upgrade-report.json in the backup folder.
  Exit codes: 0 dry run ready or upgraded; 1 refused, nothing changed; 2 bad arguments; 4 the upgrade failed and the old
  version is back; 5 the upgrade failed and the rollback did not complete (the report names the backup folder). An
  unexpected error after the installer has started counts as a failed upgrade (4 or 5), never 1; the report holds it.
.PARAMETER SelfTest
  Born-failing checks against fake registry roots under HKCU\Software\nqt-upgrade-selftest-<id> and fake folders under
  D:\dev\tmp, with fake installers; it never reads or writes the real install.
.NOTES
  The file is above the 800-line soft ceiling on purpose: one script owns the upgrade, its rollback and their self-test,
  so the fakes run the very functions the owner runs.
#>
[CmdletBinding()]
param(
    [string]$Installer = '',
    [string]$Sha256 = '',
    [string]$RollbackInstaller = '',
    [string]$RollbackSha256 = '',
    [string]$StateDir = '',
    [string]$ConfigDir = '',
    [switch]$AllowStateOverride,
    [string]$BackupRoot = 'D:\dev\backup',
    [string]$Product = 'nq-lab terminal',
    [string]$Manufacturer = 'nqlab',
    [string]$Identifier = 'dev.nqlab.terminal',
    [string]$MainBinary = 'nq-lab-terminal',
    [switch]$Go,
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Terminal = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$RealRegistryRoot = 'Registry::HKEY_CURRENT_USER\Software'
$RunTemp = 'D:\dev\tmp\upgrade-owner'
$SelfTestRoot = 'D:\dev\tmp'
$SelfTestPrefix = 'upgrade-owner-selftest-'
$SelfTestRegistryMark = 'nqt-upgrade-selftest-'
$InstallTimeoutSec = 300
$UninstallTimeoutSec = 180
$MinInstallDriveFreeMb = 100
$BackupMarginMb = 100
$LockName = 'backend.lock'
$BackendCommand = '(^|\s)-m\s+nq_terminal(\s|$)'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$ExitOk = 0; $ExitRefused = 1; $ExitUsage = 2; $ExitRolledBack = 4; $ExitRollbackFailed = 5

# ---- small readers -------------------------------------------------------------------------------------------------------

function Get-Sha256 {
    # Opened with every share flag, so a file another process keeps open is still read and never locked by this script.
    param([string]$Path)
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]'ReadWrite, Delete')
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { return (($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $sha.Dispose() }
    } finally { $stream.Dispose() }
}

function Format-Folder {
    param([string]$Path)
    return "$Path".Trim().Trim('"').TrimEnd('\')
}

function Get-NameKey {
    # The release upload turns spaces into dots, so installer names compare that way.
    param([string]$Name)
    return (($Name -split '[\\/]')[-1] -replace ' ', '.').ToLowerInvariant()
}

function Read-SumsHash {
    # The SHA256 that SHA256SUMS beside the installer lists for it, '' when the file or the line is missing.
    param([string]$InstallerPath)
    $sums = Join-Path (Split-Path $InstallerPath -Parent) 'SHA256SUMS'
    if (-not (Test-Path -LiteralPath $sums -PathType Leaf)) { return '' }
    $want = Get-NameKey $InstallerPath
    foreach ($line in [System.IO.File]::ReadAllLines($sums)) {
        $m = [regex]::Match($line, '^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$')
        if ($m.Success -and (Get-NameKey $m.Groups[2].Value) -eq $want) { return $m.Groups[1].Value.ToLowerInvariant() }
    }
    return ''
}

function Get-InstallerVersion {
    # x.y.z from '<product>_<x.y.z>_x64-setup.exe' (space or dot in the product name); '' for any other name, so a measure
    # or smoke installer ('<product> measure_...') is never taken for the release one.
    param([string]$InstallerPath, [string]$ProductName)
    $pattern = '^' + ([regex]::Escape($ProductName) -replace '\\ ', '[ .]') + '_([0-9]+\.[0-9]+\.[0-9]+)_x64-setup\.exe$'
    $m = [regex]::Match((Split-Path $InstallerPath -Leaf), $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}

function Test-InstallerFile {
    # The facts and the problems of one installer file; it never runs the file.
    param([string]$Path, [string]$GivenHash, [string]$Label, [string]$ProductName)
    $out = New-Object System.Collections.Generic.List[string]
    $info = [ordered]@{ path = $Path; version = ''; sha256 = ''; expected = ''; source = '' }
    if (-not $Path) { $out.Add("the $Label installer is not given"); return @{ info = $info; problems = $out } }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { $out.Add("the $Label installer $Path does not exist"); return @{ info = $info; problems = $out } }
    $info.version = Get-InstallerVersion $Path $ProductName
    if (-not $info.version) { $out.Add("the $Label installer name '$(Split-Path $Path -Leaf)' is not '${ProductName}_<x.y.z>_x64-setup.exe'") }
    $provenance = Join-Path (Split-Path $Path -Parent) 'PROVENANCE.json'
    if ($info.version -and (Test-Path -LiteralPath $provenance -PathType Leaf)) {
        $named = ''
        try { $named = "$((Get-Content -Raw -LiteralPath $provenance -Encoding UTF8 | ConvertFrom-Json).version)" } catch { $named = '' }
        if ($named -ne $info.version) { $out.Add("PROVENANCE.json beside the $Label installer names version '$named', the file name says $($info.version)") }
    }
    $info.sha256 = Get-Sha256 $Path
    $sums = Read-SumsHash $Path
    if ($GivenHash) { $info.expected = $GivenHash.Trim().ToLowerInvariant(); $info.source = 'the value given' } else { $info.expected = $sums; $info.source = 'SHA256SUMS beside it' }
    if (-not $info.expected) { $out.Add("no expected SHA256 for the $Label installer: give it, or keep SHA256SUMS beside the installer") }
    elseif ($info.expected -ne $info.sha256) { $out.Add("the $Label installer hashes to $($info.sha256), not $($info.expected) ($($info.source))") }
    if ($GivenHash -and $sums -and ($sums -ne $info.sha256)) { $out.Add("SHA256SUMS beside the $Label installer lists $sums, the file hashes to $($info.sha256)") }
    return @{ info = $info; problems = $out }
}

function Get-RegistryValues {
    param([string]$Key)
    if (-not (Test-Path -LiteralPath $Key)) { return $null }
    $item = Get-Item -LiteralPath $Key
    $values = [ordered]@{}
    foreach ($name in @($item.GetValueNames() | Sort-Object)) {
        $label = if ($name -eq '') { '(default)' } else { $name }
        $values[$label] = "$($item.GetValue($name, $null, 'DoNotExpandEnvironmentNames'))"
    }
    return $values
}

function Get-InstallFacts {
    param($Ctx)
    $uninstall = Get-RegistryValues $Ctx.UninstallKey
    $folder = Get-RegistryValues $Ctx.FolderKey
    $pick = { param($values, $name) if (($null -ne $values) -and $values.Contains($name)) { "$($values[$name])" } else { '' } }
    return [ordered]@{
        installed = ($null -ne $uninstall)
        version = (& $pick $uninstall 'DisplayVersion')
        location = (Format-Folder (& $pick $uninstall 'InstallLocation'))
        remembered = (Format-Folder (& $pick $folder '(default)'))
        uninstall_values = $uninstall
        folder_values = $folder
    }
}

function Get-SystemProcesses {
    return @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ id = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; name = "$($_.Name)"; path = "$($_.ExecutablePath)"; command = "$($_.CommandLine)" } })
}

function Get-LockPid {
    # The pid a backend lock names: 0 with no lock, -1 when it cannot be read. Only the pid is kept: the rest of the file
    # holds the session secret and is never printed or stored.
    param([string]$StateFolder)
    $lock = Join-Path $StateFolder $LockName
    if (-not (Test-Path -LiteralPath $lock -PathType Leaf)) { return 0 }
    try {
        $stream = [System.IO.File]::Open($lock, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]'ReadWrite, Delete')
        try { $text = (New-Object System.IO.StreamReader($stream, $Utf8)).ReadToEnd() } finally { $stream.Dispose() }
        $m = [regex]::Match($text, '"pid"\s*:\s*([0-9]+)')
        $text = $null
        if ($m.Success) { return [int]$m.Groups[1].Value }
        return -1
    } catch { return -1 }
}

function Get-AppProblems {
    # The app and every backend must be closed: no process from the install folder or under the app's name, no process
    # running "python -m nq_terminal" (a browser door started before the lock existed holds no lock), and no live process
    # behind backend.lock.
    param($Ctx, [string]$Folder)
    $out = New-Object System.Collections.Generic.List[string]
    $procs = @(& $Ctx.ListProcesses)
    $exe = "$($Ctx.MainBinary).exe"
    $prefix = if ($Folder) { $Folder.TrimEnd('\') + '\' } else { '' }
    foreach ($p in $procs) {
        $under = $prefix -and $p.path -and $p.path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
        if ($under -or ($p.name -ieq $exe)) { $out.Add("the app is running (process $($p.id), $($p.path)): close it first") }
        $command = if ($p.PSObject.Properties['command']) { "$($p.command)" } else { '' }
        if ($command -match $BackendCommand) { $out.Add("a terminal backend is running (process $($p.id), python -m nq_terminal): close every door (the app and any start.ps1 window)") }
    }
    $lockPid = Get-LockPid $Ctx.StateDir
    if ($lockPid -lt 0) { $out.Add("$LockName in $($Ctx.StateDir) cannot be read, so a backend may hold it: close every door (the app and any start.ps1 window)") }
    elseif ($lockPid -gt 0 -and @($procs | Where-Object { $_.id -eq $lockPid }).Count -gt 0) {
        $out.Add("a backend of this lab is running (process $lockPid holds $LockName): close every door (the app and any start.ps1 window)")
    }
    $out
}

function Get-ShortcutNames {
    param([string]$ProductName)
    $found = foreach ($f in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
        if ($f -and (Test-Path -LiteralPath $f)) { Get-ChildItem -LiteralPath $f -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*$ProductName*" } | ForEach-Object { $_.FullName } }
    }
    $found | Where-Object { $_ }
}

# ---- manifests -------------------------------------------------------------------------------------------------------------

function Get-Areas {
    param($Ctx, [string]$InstallFolder)
    return @(
        @{ name = 'install'; root = $InstallFolder; skip = @() },
        @{ name = 'state'; root = $Ctx.StateDir; skip = @($LockName) },
        @{ name = 'config'; root = $Ctx.ConfigDir; skip = @() })
}

function Get-Manifest {
    # One entry per file of each area: the area, the relative path, the size and the SHA256 ('unreadable: ...' if it
    # could not be read). A file named in the area's skip list (the backend lock) is never listed or copied.
    param($Areas)
    foreach ($area in $Areas) {
        if (-not $area.root -or -not (Test-Path -LiteralPath $area.root -PathType Container)) { continue }
        $root = (Get-Item -LiteralPath $area.root).FullName.TrimEnd('\')
        foreach ($file in @(Get-ChildItem -LiteralPath $root -Recurse -Force -File | Sort-Object FullName)) {
            $rel = $file.FullName.Substring($root.Length).TrimStart('\')
            if ($area.skip -contains $rel) { continue }
            $hash = try { Get-Sha256 $file.FullName } catch { "unreadable: $($_.Exception.Message)" }
            [pscustomobject][ordered]@{ area = $area.name; path = $rel; size = [long]$file.Length; sha256 = $hash }
        }
    }
}

function Compare-Manifest {
    # Changed, missing and added files between an expected and an actual manifest, each named. Pure, so it can be tested.
    param($Expected, $Actual, [string[]]$Areas)
    $out = New-Object System.Collections.Generic.List[string]
    $want = @{}; foreach ($e in @($Expected | Where-Object { $Areas -contains $_.area })) { $want["$($e.area)\$($e.path)"] = $e }
    $have = @{}; foreach ($e in @($Actual | Where-Object { $Areas -contains $_.area })) { $have["$($e.area)\$($e.path)"] = $e }
    foreach ($k in @($want.Keys | Sort-Object)) {
        if (-not $have.ContainsKey($k)) { $out.Add("missing: $k") } elseif ($have[$k].sha256 -ne $want[$k].sha256) { $out.Add("changed: $k") }
    }
    foreach ($k in @($have.Keys | Sort-Object)) { if (-not $want.ContainsKey($k)) { $out.Add("added: $k") } }
    $out
}

function Get-BackupAreas {
    param([string]$BackupDir)
    return @('install', 'state', 'config') | ForEach-Object { @{ name = $_; root = (Join-Path $BackupDir $_); skip = @() } }
}

function Test-BackupCopy {
    # The copies in the backup folder must hash exactly as the manifest says (born failing in the self-test).
    param([string]$BackupDir, $Manifest)
    Compare-Manifest $Manifest @(Get-Manifest (Get-BackupAreas $BackupDir)) @('install', 'state', 'config')
}

function New-Backup {
    param($Ctx, $Pre)
    $dir = Join-Path $Ctx.BackupRoot ('nqt-{0}-{1}' -f $Pre.facts.version, $Ctx.Stamp)
    if (Test-Path -LiteralPath $dir) { throw "the backup folder $dir exists already" }
    Protect-Folder $dir
    $roots = @{}; foreach ($a in (Get-Areas $Ctx $Pre.facts.location)) { $roots[$a.name] = $a.root }
    foreach ($e in $Pre.manifest) {
        $target = Join-Path (Join-Path $dir $e.area) $e.path
        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
        Copy-Item -LiteralPath (Join-Path $roots[$e.area] $e.path) -Destination $target -Force
    }
    $registry = [ordered]@{ uninstall_key = $Ctx.UninstallKey; uninstall_values = $Pre.facts.uninstall_values; folder_key = $Ctx.FolderKey; folder_values = $Pre.facts.folder_values }
    Write-Json (Join-Path $dir 'registry.json') $registry
    Write-Json (Join-Path $dir 'manifest.json') ([ordered]@{ written_utc = (Get-Date).ToUniversalTime().ToString('o'); roots = $roots; install_sddl = $Pre.install_sddl; files = @($Pre.manifest) })
    return $dir
}

function Write-Json {
    param([string]$Path, $Value)
    [System.IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 8) -replace "`r`n", "`n") + "`n", $Utf8)
}

# ---- the install folder's DACL (hand-over section 6; the same rules as install-test.ps1) --------------------------------

function Get-BroadWriters {
    # Allow rules that let Everyone, Users or Authenticated Users (by SID) write, delete or change permissions.
    param($Rules)
    $broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
    $writeMask = 2 -bor 4 -bor 64 -bor 65536 -bor 262144 -bor 524288
    $Rules | Where-Object { $_.type -eq 'Allow' -and ($broadSids -contains $_.sid) -and (($_.mask -band $writeMask) -ne 0) }
}

function Get-AclFacts {
    param([string]$Path)
    $acl = Get-Acl -LiteralPath $Path
    $rules = @($acl.Access | ForEach-Object {
        $sid = try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { '' }
        [ordered]@{ identity = "$($_.IdentityReference)"; sid = $sid; mask = [int]$_.FileSystemRights; type = "$($_.AccessControlType)"; inherited = $_.IsInherited } })
    return [ordered]@{ protected = $acl.AreAccessRulesProtected; rules = $rules; sddl = $acl.Sddl }
}

function Get-PrincipalProblems {
    # Exactly the user, SYSTEM and Administrators as Allow rules, inheritance removed, nothing inherited. Pure.
    param($Report, [string]$UserSid)
    $out = @()
    if (-not $Report.protected) { $out += 'the folder still inherits from its parent' }
    $inherited = @($Report.rules | Where-Object { $_.inherited })
    if ($inherited.Count -gt 0) { $out += "inherited rules: $(@($inherited | ForEach-Object { $_.identity }) -join ', ')" }
    $expected = @(@($UserSid, 'S-1-5-18', 'S-1-5-32-544') | Sort-Object -Unique)
    $actual = @(@($Report.rules | ForEach-Object { $_.sid }) | Sort-Object -Unique)
    if (($actual -join ',') -ne ($expected -join ',')) { $out += "principals are [$($actual -join ', ')], expected [$($expected -join ', ')]" }
    if (@($Report.rules | Where-Object { $_.type -ne 'Allow' }).Count -gt 0) { $out += 'a rule that is not Allow' }
    $out
}

function Get-DaclProblems {
    param([string]$Folder, [string]$Binary)
    if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { "the install folder $Folder is missing"; return }
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $out = @(Get-PrincipalProblems (Get-AclFacts $Folder) $user | ForEach-Object { "install folder: $_" })
    foreach ($name in "$Binary.exe", 'WebView2Loader.dll', 'uninstall.exe') {
        $file = Join-Path $Folder $name
        if (-not (Test-Path -LiteralPath $file)) { continue }
        $broad = @(Get-BroadWriters (Get-AclFacts $file).rules)
        if ($broad.Count -gt 0) { $out += "${name}: writable by $(@($broad | ForEach-Object { $_.identity }) -join ', ')" }
    }
    $out
}

# ---- running installers (hidden, no shell, TEMP on D:) ---------------------------------------------------------------------

function Invoke-Hidden {
    # Starts a program without the shell and without a window and waits for it and every child it started (the NSIS
    # uninstaller copies itself to TEMP and returns early). Returns the exit code, or -1 on a timeout.
    param($Ctx, [string]$File, [string]$ArgumentText, [int]$TimeoutSec)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = $ArgumentText
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WorkingDirectory = $Ctx.TempDir
    $info.EnvironmentVariables['TEMP'] = $Ctx.TempDir
    $info.EnvironmentVariables['TMP'] = $Ctx.TempDir
    $proc = [System.Diagnostics.Process]::Start($info)
    $tracked = New-Object 'System.Collections.Generic.List[int]'
    $tracked.Add($proc.Id)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        foreach ($p in @(Get-SystemProcesses | Where-Object { $tracked -contains $_.parent })) { if (-not $tracked.Contains($p.id)) { $tracked.Add($p.id) } }
        $alive = @($tracked | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        if ($proc.HasExited -and $alive.Count -eq 0) { return $proc.ExitCode }
        Start-Sleep -Milliseconds 250
    }
    return -1
}

$RealInstaller = {
    param($Ctx, [string]$Path, [string]$ArgumentText)
    return Invoke-Hidden $Ctx $Path $ArgumentText $InstallTimeoutSec
}

$RealUninstaller = {
    # '' on success, else what went wrong. A silent uninstall keeps the app data and the remembered-folder key.
    param($Ctx, [string]$Folder)
    $uninstaller = Join-Path $Folder 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { return "no $uninstaller" }
    $code = Invoke-Hidden $Ctx $uninstaller '/S' $UninstallTimeoutSec
    for ($i = 0; $i -lt 40 -and (Test-Path -LiteralPath (Join-Path $Folder "$($Ctx.MainBinary).exe")); $i++) { Start-Sleep -Milliseconds 250 }
    if ($code -ne 0) { return "the uninstaller exited with $code" }
    if (Test-Path -LiteralPath (Join-Path $Folder "$($Ctx.MainBinary).exe")) { return 'the uninstaller left the exe' }
    return ''
}

# ---- preflight, verify, rollback -------------------------------------------------------------------------------------------

function Read-AppLab {
    # The 'lab' the app keeps in settings.json (or settings.json.1, the copy the app falls back to), '' when neither holds one.
    param([string]$ConfigFolder)
    foreach ($name in 'settings.json', 'settings.json.1') {
        $file = Join-Path $ConfigFolder $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        try { $json = [System.IO.File]::ReadAllText($file) | ConvertFrom-Json } catch { continue }
        if ($json -and ($json.PSObject.Properties.Name -contains 'lab') -and "$($json.lab)".Trim()) { return @{ lab = "$($json.lab)".Trim(); file = $file } }
    }
    return $null
}

function Resolve-StateFolder {
    # The folder the installed app's backend uses is <lab>\terminal\state, lab from its settings. -StateDir or NQT_STATE_DIR
    # (a smoke or test run may have left it set) is only accepted when it is that folder, or with an explicit override.
    param([string]$ConfigFolder, [string]$Given, [string]$FromEnv, [bool]$AllowOverride)
    $problems = New-Object System.Collections.Generic.List[string]
    $app = Read-AppLab $ConfigFolder
    $appState = if ($app) { Join-Path (Join-Path $app.lab 'terminal') 'state' } else { '' }
    $asked = if ($Given) { $Given } else { $FromEnv }
    $askedBy = if ($Given) { 'the -StateDir argument' } else { 'the NQT_STATE_DIR environment variable' }
    $path = ''; $source = ''
    if (-not $asked) {
        if ($app) { $path = $appState; $source = "the app's settings ($($app.file)): lab $($app.lab)" }
        else { $problems.Add("cannot read the lab from settings.json or settings.json.1 in $ConfigFolder, so the app's state folder is unknown (give -StateDir)") }
    } elseif (-not $app) {
        if ($Given -or $AllowOverride) { $path = $asked; $source = "$askedBy (the app's settings could not be read, so it is not checked)" }
        else { $problems.Add("cannot read the lab from settings.json or settings.json.1 in $ConfigFolder, so $askedBy ($asked) cannot be checked (give -StateDir)") }
    } elseif ([System.IO.Path]::GetFullPath($asked).TrimEnd('\') -ieq [System.IO.Path]::GetFullPath($appState).TrimEnd('\')) {
        $path = $asked; $source = "$askedBy, the same folder as the app's settings ($($app.file)): lab $($app.lab)"
    } elseif ($AllowOverride) {
        $path = $asked; $source = "OVERRIDE from $askedBy (-AllowStateOverride); the app itself uses $appState"
    } else {
        $problems.Add("the state folder from $askedBy ($asked) is not the one the app uses ($appState, from the lab in $($app.file)); backing up and restoring it would miss the real workspaces and jobs. Clear it, or add -AllowStateOverride")
    }
    return @{ path = $path; source = $source; problems = @($problems) }
}

function New-Context {
    param([string]$RegistryRoot, [string]$ProductName, [string]$ManufacturerName, [string]$Binary, [string]$State, [string]$Config,
        [string]$Backups, [string]$Temp, [string]$NewInstaller, [string]$NewHash, [string]$OldInstaller, [string]$OldHash, [string]$StateSource = '')
    return @{
        StateSource = $StateSource
        Product = $ProductName; Manufacturer = $ManufacturerName; MainBinary = $Binary
        UninstallKey = "$RegistryRoot\Microsoft\Windows\CurrentVersion\Uninstall\$ProductName"
        FolderKey = "$RegistryRoot\$ManufacturerName\$ProductName"
        StateDir = $State; ConfigDir = $Config; BackupRoot = $Backups; TempDir = $Temp
        Installer = $NewInstaller; Sha256 = $NewHash; RollbackInstaller = $OldInstaller; RollbackSha256 = $OldHash
        Stamp = (Get-Date -Format 'yyyyMMdd-HHmmss')
        ListProcesses = { Get-SystemProcesses }; RunInstaller = $RealInstaller; RunUninstaller = $RealUninstaller; Quiet = $false
    }
}

function Get-FreeMb {
    param([string]$Path)
    return [math]::Floor((New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($Path))).AvailableFreeSpace / 1MB)
}

function Test-Inside {
    param([string]$Path, [string]$Folder)
    if (-not $Path -or -not $Folder) { return $false }
    $p = [System.IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    return $p.StartsWith([System.IO.Path]::GetFullPath($Folder).TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)
}

function Invoke-Preflight {
    param($Ctx)
    $problems = New-Object System.Collections.Generic.List[string]
    $facts = Get-InstallFacts $Ctx
    if (-not $facts.installed) { $problems.Add("no install of '$($Ctx.Product)' for this user ($($Ctx.UninstallKey)): nothing to upgrade") }
    elseif (-not $facts.location -or -not (Test-Path -LiteralPath $facts.location -PathType Container)) { $problems.Add("InstallLocation '$($facts.location)' is not a folder") }
    elseif ($facts.remembered -ine $facts.location) { $problems.Add("the folder the installer remembers ('$($facts.remembered)') is not InstallLocation ('$($facts.location)'), so a silent install would not go over this copy") }
    $new = Test-InstallerFile $Ctx.Installer $Ctx.Sha256 'new' $Ctx.Product
    $old = Test-InstallerFile $Ctx.RollbackInstaller $Ctx.RollbackSha256 'rollback' $Ctx.Product
    foreach ($p in @($new.problems) + @($old.problems)) { $problems.Add($p) }
    if ($facts.installed -and $new.info.version -and ($new.info.version -eq $facts.version)) { $problems.Add("version $($facts.version) is installed already: nothing to upgrade") }
    if ($facts.installed -and $old.info.version -and ($old.info.version -ne $facts.version)) { $problems.Add("the rollback installer is $($old.info.version), the installed version is $($facts.version)") }
    foreach ($p in (Get-AppProblems $Ctx $facts.location)) { $problems.Add($p) }
    if (-not (Test-Path -LiteralPath $Ctx.StateDir -PathType Container)) { $problems.Add("the state folder $($Ctx.StateDir) does not exist (give -StateDir)") }
    foreach ($inner in @($facts.location, $Ctx.StateDir, $Ctx.ConfigDir)) { if (Test-Inside $Ctx.BackupRoot $inner) { $problems.Add("the backup folder $($Ctx.BackupRoot) is inside $inner") } }
    $manifest = @(if ($facts.location -and (Test-Path -LiteralPath $facts.location)) { Get-Manifest (Get-Areas $Ctx $facts.location) })
    foreach ($e in @($manifest | Where-Object { $_.sha256 -like 'unreadable*' })) { $problems.Add("$($e.area)\$($e.path) is $($e.sha256)") }
    $bytes = [long]0
    foreach ($e in $manifest) { $bytes += $e.size }
    $sddl = ''
    if ($facts.location -and (Test-Path -LiteralPath $facts.location)) {
        $sddl = (Get-AclFacts $facts.location).sddl
        $free = Get-FreeMb $facts.location
        if ($free -lt $MinInstallDriveFreeMb) { $problems.Add("$free MB free on the install drive, at least $MinInstallDriveFreeMb MB needed") }
    }
    $backupFree = Get-FreeMb $Ctx.BackupRoot
    if ($backupFree -lt ([math]::Ceiling($bytes / 1MB) + $BackupMarginMb)) { $problems.Add("$backupFree MB free on the backup drive, the backup needs $([math]::Ceiling($bytes / 1MB)) MB plus $BackupMarginMb MB") }
    return [ordered]@{ problems = @($problems); facts = $facts; new = $new.info; old = $old.info; manifest = $manifest; bytes = $bytes; install_sddl = $sddl }
}

function Test-AfterInstall {
    # The checks after an install (the upgrade, or the rollback's reinstall), each failure named.
    param($Ctx, $Pre, [int]$ExitCode, [string]$ExpectVersion, [string[]]$ShortcutsBefore)
    $out = New-Object System.Collections.Generic.List[string]
    if ($ExitCode -ne 0) { $out.Add("the installer exited with $ExitCode") }
    $facts = Get-InstallFacts $Ctx
    if ($facts.version -ne $ExpectVersion) { $out.Add("DisplayVersion is '$($facts.version)', expected $ExpectVersion") }
    if ($facts.location -ine $Pre.facts.location) { $out.Add("InstallLocation is '$($facts.location)', was '$($Pre.facts.location)'") }
    if ($facts.remembered -ine $Pre.facts.location) { $out.Add("the remembered folder is '$($facts.remembered)', was '$($Pre.facts.location)'") }
    $exe = Join-Path $Pre.facts.location "$($Ctx.MainBinary).exe"
    if (-not (Test-Path -LiteralPath $exe)) { $out.Add("$exe is missing") }
    else {
        $product = "$((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion)"
        if ($product -and -not $product.StartsWith($ExpectVersion)) { $out.Add("the exe's version resource says $product, expected $ExpectVersion") }
    }
    foreach ($p in (Get-DaclProblems $Pre.facts.location $Ctx.MainBinary)) { $out.Add("DACL: $p") }
    foreach ($p in (Get-AppProblems $Ctx $Pre.facts.location)) { $out.Add("after the install: $p") }
    $new = @((Get-ShortcutNames $Ctx.Product) | Where-Object { $ShortcutsBefore -notcontains $_ })
    if ($new.Count -gt 0) { $out.Add("new shortcut: $($new -join ', ')") }
    $out
}

function Get-StateDifferences {
    param($Ctx, $Pre)
    Compare-Manifest $Pre.manifest @(Get-Manifest (Get-Areas $Ctx $Pre.facts.location)) @('state', 'config')
}

function Restore-State {
    # Copies back every state or config file that is missing or changed against the manifest, then hashes again.
    # A file that was added since the backup is left in place and named.
    param($Ctx, $Pre, [string]$BackupDir)
    $roots = @{}; foreach ($a in (Get-Areas $Ctx $Pre.facts.location)) { $roots[$a.name] = $a.root }
    $notes = New-Object System.Collections.Generic.List[string]
    foreach ($d in (Get-StateDifferences $Ctx $Pre)) {
        $kind, $key = $d -split ': ', 2
        $area, $rel = $key -split '\\', 2
        if ($kind -eq 'added') { $notes.Add("left in place, not in the backup: $key"); continue }
        $live = Join-Path $roots[$area] $rel
        $copy = Join-Path (Join-Path $BackupDir $area) $rel
        $want = @($Pre.manifest | Where-Object { $_.area -eq $area -and $_.path -eq $rel })
        $have = if (Test-Path -LiteralPath $copy -PathType Leaf) { try { Get-Sha256 $copy } catch { '' } } else { '' }
        if ($want.Count -ne 1 -or $have -ne $want[0].sha256) { $notes.Add("refused, the backup copy does not match the manifest: $key"); continue }
        New-Item -ItemType Directory -Force -Path (Split-Path $live -Parent) | Out-Null
        Copy-Item -LiteralPath $copy -Destination $live -Force
        $notes.Add("restored: $key")
    }
    $left = @(Get-StateDifferences $Ctx $Pre | Where-Object { $_ -notlike 'added:*' })
    return @{ notes = @($notes); problems = $left }
}

function Invoke-Rollback {
    param($Ctx, $Pre, [string]$BackupDir, [string[]]$ShortcutsBefore)
    $notes = New-Object System.Collections.Generic.List[string]
    $running = @(Get-AppProblems $Ctx $Pre.facts.location)
    if ($running.Count -gt 0) { return @{ ok = $false; notes = @("rollback not started: $($running -join '; ')") } }
    $now = Get-InstallFacts $Ctx
    $installNow = @(Get-Manifest @((Get-Areas $Ctx $Pre.facts.location)[0]))
    $untouched = ($now.version -eq $Pre.facts.version) -and ($now.location -ieq $Pre.facts.location) -and (@(Compare-Manifest $Pre.manifest $installNow @('install')).Count -eq 0)
    $ok = $true
    if ($untouched) { $notes.Add("the install is unchanged ($($Pre.facts.version)), so it was not reinstalled") }
    else {
        if (Test-Path -LiteralPath (Join-Path $Pre.facts.location 'uninstall.exe')) {
            $u = & $Ctx.RunUninstaller $Ctx $Pre.facts.location
            $notes.Add($(if ($u) { "uninstall of the new version: $u (the reinstall goes on)" } else { 'the new version was uninstalled (app data kept)' }))
        }
        $code = & $Ctx.RunInstaller $Ctx $Ctx.RollbackInstaller "/S /NS /D=$($Pre.facts.location)"
        $after = @(Test-AfterInstall $Ctx $Pre $code $Pre.old.version $ShortcutsBefore)
        if ($after.Count -gt 0) { $ok = $false; foreach ($p in $after) { $notes.Add("reinstall of $($Pre.old.version): $p") } }
        else { $notes.Add("$($Pre.old.version) reinstalled into $($Pre.facts.location) and verified") }
    }
    $restore = Restore-State $Ctx $Pre $BackupDir
    foreach ($n in $restore.notes) { $notes.Add($n) }
    if ($restore.problems.Count -gt 0) { $ok = $false; foreach ($p in $restore.problems) { $notes.Add("state not restored: $p") } }
    return @{ ok = $ok; notes = @($notes) }
}

function Write-Plan {
    param($Ctx, $Pre, [bool]$DoIt)
    if ($Ctx.Quiet) { return }
    $f = $Pre.facts
    Write-Host ("{0} of '{1}'" -f $(if ($DoIt) { 'UPGRADE' } else { 'DRY RUN (nothing is changed; add -Go to act)' }), $Ctx.Product)
    Write-Host "  installed:          $($f.version) in '$($f.location)' (remembered folder '$($f.remembered)')"
    Write-Host "  new installer:      $($Pre.new.path) ($($Pre.new.version), sha256 $($Pre.new.sha256), checked against $($Pre.new.source))"
    Write-Host "  rollback installer: $($Pre.old.path) ($($Pre.old.version), checked against $($Pre.old.source))"
    $counts = @('install', 'state', 'config' | ForEach-Object { $n = $_; "$n $(@($Pre.manifest | Where-Object { $_.area -eq $n }).Count) files" }) -join ', '
    Write-Host "  backup:             $(Join-Path $Ctx.BackupRoot ('nqt-{0}-{1}' -f $f.version, $Ctx.Stamp)) ($counts, $([math]::Ceiling($Pre.bytes / 1KB)) KB; $LockName is never copied)"
    Write-Host "  state folder:       $($Ctx.StateDir)$(if ($Ctx.StateSource) { " (from $($Ctx.StateSource))" }); config folder: $($Ctx.ConfigDir)"
    Write-Host "  steps:              backup and re-hash; '$(Split-Path $Pre.new.path -Leaf)' /S /NS (remembered folder); verify version, folder, DACL, state; roll back on any failure; the app is never started"
    foreach ($p in $Pre.problems) { Write-Host "  REFUSE  $p" }
}

function Invoke-Upgrade {
    param($Ctx, [bool]$DoIt)
    $pre = Invoke-Preflight $Ctx
    Write-Plan $Ctx $pre $DoIt
    $result = [ordered]@{ status = ''; problems = @(); backup = ''; rollback = @(); from = $pre.facts.version; to = $pre.new.version }
    if ($pre.problems.Count -gt 0) { $result.status = 'refused'; $result.problems = $pre.problems; return $result }
    if (-not $DoIt) { $result.status = 'dry-run'; return $result }
    # The installer and the uninstaller run NSIS plugin DLLs out of TEMP, so every run gets a fresh, protected TEMP folder
    # (the shared parent inherits write access for other local accounts) that is deleted afterwards.
    $parentTemp = $Ctx.TempDir
    $runTemp = Join-Path $parentTemp "run-$($Ctx.Stamp)"
    if (Test-Path -LiteralPath $runTemp) { $result.status = 'refused'; $result.problems = @("the run folder $runTemp already exists; nothing was started"); return $result }
    try {
        Protect-Folder $runTemp
        $open = @(Get-PrincipalProblems (Get-AclFacts $runTemp) ([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value))
        if ($open.Count -gt 0) { $result.status = 'refused'; $result.problems = @("the run folder $runTemp is not private: $($open -join '; ')"); return $result }
        $Ctx.TempDir = $runTemp
        return (Invoke-UpgradeRun $Ctx $pre $result)
    }
    finally {
        $Ctx.TempDir = $parentTemp
        try { if (Test-Path -LiteralPath $runTemp) { Remove-Item -LiteralPath $runTemp -Recurse -Force } }
        catch { if (-not $Ctx.Quiet) { Write-Host "  note: the run folder $runTemp could not be deleted ($($_.Exception.Message))" } }
    }
}

function Invoke-UpgradeRun {
    param($Ctx, $pre, $result)
    # Exit code 1 means "refused, nothing changed", so any error from here on is caught: before the installer starts the
    # install is untouched (refused); once it has started the error is a failed upgrade and the rollback is attempted.
    $result.error = ''
    $installStarted = $false
    $backup = ''
    $shortcuts = @()
    try {
        $backup = New-Backup $Ctx $pre
        $result.backup = $backup
        $bad = @(Test-BackupCopy $backup $pre.manifest)
        if ($bad.Count -gt 0) { $result.status = 'refused'; $result.problems = @("the backup copy does not match its manifest: $($bad -join '; ')"); Write-Json (Join-Path $backup 'upgrade-report.json') $result; return $result }
        $shortcuts = @(Get-ShortcutNames $Ctx.Product)
        $installStarted = $true
        $code = & $Ctx.RunInstaller $Ctx $Ctx.Installer '/S /NS'
        $problems = @(Test-AfterInstall $Ctx $pre $code $pre.new.version $shortcuts) + @(Get-StateDifferences $Ctx $pre | ForEach-Object { "state or config file $_" })
        if ($problems.Count -eq 0) { $result.status = 'upgraded' }
        else {
            $result.problems = $problems
            $rollback = Invoke-Rollback $Ctx $pre $backup $shortcuts
            $result.rollback = $rollback.notes
            $result.status = if ($rollback.ok) { 'rolled-back' } else { 'rollback-failed' }
        }
    }
    catch {
        $message = $_.Exception.Message
        $result.error = $message
        if (-not $installStarted) {
            $result.status = 'refused'
            $result.problems = @($result.problems) + @("an unexpected error before the installer started, the install was not touched: $message")
        }
        else {
            $result.problems = @($result.problems) + @("an unexpected error after the installer started: $message")
            try {
                $rollback = Invoke-Rollback $Ctx $pre $backup $shortcuts
                $result.rollback = @($result.rollback) + @($rollback.notes)
                $result.status = if ($rollback.ok) { 'rolled-back' } else { 'rollback-failed' }
            }
            catch {
                $result.rollback = @($result.rollback) + @("the rollback itself failed: $($_.Exception.Message)")
                $result.status = 'rollback-failed'
            }
        }
    }
    if ($backup) {
        try { Write-Json (Join-Path $backup 'upgrade-report.json') $result }
        catch { if (-not $Ctx.Quiet) { Write-Host "  note: upgrade-report.json could not be written ($($_.Exception.Message))" } }
    }
    return $result
}

function Get-ExitCode {
    param($Result)
    switch ($Result.status) { 'dry-run' { return $ExitOk } 'upgraded' { return $ExitOk } 'refused' { return $ExitRefused } 'rolled-back' { return $ExitRolledBack } default { return $ExitRollbackFailed } }
}

function Write-Outcome {
    param($Result)
    switch ($Result.status) {
        'dry-run' { Write-Host 'dry run: every check passed; nothing was changed. Run again with -Go to upgrade.' }
        'refused' {
            if ($Result.Contains('error') -and $Result.error) { Write-Host "  ERROR  $($Result.error)" }
            Write-Host "refused: nothing was changed. $(@($Result.problems).Count) problem(s) above."
        }
        'upgraded' { Write-Host "upgraded $($Result.from) to $($Result.to); backup in $($Result.backup). Start the app yourself and check HOME, a workspace LOAD and the look." }
        default {
            foreach ($p in $Result.problems) { Write-Host "  FAIL  $p" }
            if ($Result.Contains('error') -and $Result.error) { Write-Host "  ERROR  $($Result.error)" }
            foreach ($n in $Result.rollback) { Write-Host "  ROLLBACK  $n" }
            if ($Result.status -eq 'rolled-back') { Write-Host "the upgrade failed and was rolled back: $($Result.from) is installed again and the state is as before. Backup and report: $($Result.backup)" }
            else { Write-Host "the upgrade failed and the ROLLBACK DID NOT COMPLETE. Restore by hand from $($Result.backup) (manifest.json, registry.json); the report is upgrade-report.json there." }
        }
    }
}

# ---- self-test (fake registry roots and folders under D:\dev\tmp, fake installers) ---------------------------------------

$SelfResults = New-Object System.Collections.Generic.List[object]

function Expect {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    $SelfResults.Add([pscustomobject]@{ name = $Name; passed = $Condition })
    Write-Host ("{0}  self-test {1}{2}" -f $(if ($Condition) { 'PASS' } else { 'FAIL' }), $Name, $(if ($Condition -or -not $Detail) { '' } else { "  ($Detail)" }))
}

function Assert-SelfTestContext {
    # The fakes refuse to act on anything but a self-test fixture: never the real install, state or registry.
    param($Ctx)
    $mark = Join-Path $SelfTestRoot $SelfTestPrefix
    foreach ($path in @($Ctx.StateDir, $Ctx.ConfigDir, $Ctx.BackupRoot, $Ctx.TempDir, $Ctx.Installer, $Ctx.RollbackInstaller)) {
        if (-not "$path".StartsWith($mark, [System.StringComparison]::OrdinalIgnoreCase)) { throw "self-test refuses a path outside ${mark}*: $path" }
    }
    if ($Ctx.UninstallKey -notlike "*\$SelfTestRegistryMark*" -or $Ctx.FolderKey -notlike "*\$SelfTestRegistryMark*") { throw 'self-test refuses a registry key outside its fake root' }
}

function Protect-Folder {
    param([string]$Folder)
    New-Item -ItemType Directory -Force -Path $Folder | Out-Null
    $dir = Get-Item -LiteralPath $Folder
    $acl = $dir.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
    foreach ($sid in @([System.Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')), (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))) {
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    $dir.SetAccessControl($acl)
}

$FakeInstaller = {
    # Writes what the real installer writes (the three files, the uninstall entry, the remembered folder), or fails in the
    # way $Ctx.FakeMode names when it is the new installer. Returns an exit code.
    param($Ctx, [string]$Path, [string]$ArgumentText)
    Assert-SelfTestContext $Ctx
    $Ctx.Calls.Add("install $(Get-InstallerVersion $Path $Ctx.Product) $ArgumentText")
    $version = Get-InstallerVersion $Path $Ctx.Product
    $mode = if ($Path -eq $Ctx.Installer) { $Ctx.FakeMode } else { 'ok' }
    $m = [regex]::Match($ArgumentText, '/D=(.+)$')
    $folder = if ($m.Success) { $m.Groups[1].Value } else { (Get-InstallFacts $Ctx).remembered }
    if (-not "$folder".StartsWith((Join-Path $SelfTestRoot $SelfTestPrefix), [System.StringComparison]::OrdinalIgnoreCase)) { throw "fake installer refuses '$folder'" }
    if ($mode -eq 'refused-untouched') { return 3 }
    Protect-Folder $folder
    foreach ($name in "$($Ctx.MainBinary).exe", 'WebView2Loader.dll', 'uninstall.exe') { [System.IO.File]::WriteAllText((Join-Path $folder $name), "fake $name $version`n", $Utf8) }
    if ($mode -eq 'fail-exit') { [System.IO.File]::WriteAllText((Join-Path $folder "$($Ctx.MainBinary).exe"), "half written`n", $Utf8); return 1 }
    New-Item -Path $Ctx.UninstallKey -Force | Out-Null
    $shown = if ($mode -eq 'no-version-bump') { (Get-InstallFacts $Ctx).version } else { $version }
    Set-ItemProperty -LiteralPath $Ctx.UninstallKey -Name 'DisplayVersion' -Value $shown
    Set-ItemProperty -LiteralPath $Ctx.UninstallKey -Name 'InstallLocation' -Value "`"$folder`""
    New-Item -Path $Ctx.FolderKey -Force | Out-Null
    Set-ItemProperty -LiteralPath $Ctx.FolderKey -Name '(default)' -Value $folder
    if ($mode -eq 'touch-state') { [System.IO.File]::AppendAllText((Join-Path $Ctx.StateDir 'jobs.json'), "changed by the fake installer`n", $Utf8) }
    if ($mode -eq 'bad-acl') { & (Join-Path $env:SystemRoot 'System32\icacls.exe') $folder /grant '*S-1-5-11:(OI)(CI)M' /Q | Out-Null }
    if ($mode -eq 'throw-after-install') { throw 'simulated failure after the installer ran' }
    return 0
}

$FakeUninstaller = {
    param($Ctx, [string]$Folder)
    Assert-SelfTestContext $Ctx
    $Ctx.Calls.Add("uninstall $Folder")
    foreach ($name in "$($Ctx.MainBinary).exe", 'WebView2Loader.dll', 'uninstall.exe') { Remove-Item -LiteralPath (Join-Path $Folder $name) -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $Ctx.UninstallKey -Recurse -Force -ErrorAction SilentlyContinue
    return ''
}

function New-FakeRelease {
    param([string]$Folder, [string]$ProductName, [string]$Version)
    New-Item -ItemType Directory -Force -Path $Folder | Out-Null
    $file = Join-Path $Folder "${ProductName}_${Version}_x64-setup.exe"
    [System.IO.File]::WriteAllText($file, "fake installer $Version`n", $Utf8)
    [System.IO.File]::WriteAllText((Join-Path $Folder 'SHA256SUMS'), "$(Get-Sha256 $file) *$(Split-Path $file -Leaf)`n", $Utf8)
    return $file
}

function New-Fixture {
    # A fake install of 0.1.1 with a state folder, a config folder and fake 0.1.1 and 0.1.2 releases.
    param([string]$Mode = 'ok')
    $id = [guid]::NewGuid().ToString('N').Substring(0, 12)
    $root = Join-Path $SelfTestRoot "$SelfTestPrefix$id"
    $registry = "Registry::HKEY_CURRENT_USER\Software\$SelfTestRegistryMark$id"
    $product = 'nqt selftest product'
    $spec = @{
        RegistryRoot = $registry; ProductName = $product; ManufacturerName = 'nqtselftest'; Binary = 'nqt-selftest'
        State = (Join-Path $root 'lab\terminal\state'); Config = (Join-Path $root 'appdata\dev.nqt.selftest')
        Backups = (Join-Path $root 'backup'); Temp = (Join-Path $root 'tmp')
        NewInstaller = (New-FakeRelease (Join-Path $root 'release\0.1.2') $product '0.1.2'); NewHash = ''
        OldInstaller = (New-FakeRelease (Join-Path $root 'release\0.1.1') $product '0.1.1'); OldHash = ''
    }
    $ctx = New-Context @spec
    $ctx.Root = $root; $ctx.RegistryRoot = $registry; $ctx.Folder = Join-Path $root "Programs\$product"
    $ctx.FakeMode = $Mode; $ctx.Calls = New-Object System.Collections.Generic.List[string]; $ctx.Quiet = $true
    $ctx.ListProcesses = { @() }; $ctx.RunInstaller = $FakeInstaller; $ctx.RunUninstaller = $FakeUninstaller
    Assert-SelfTestContext $ctx
    foreach ($rel in 'workspaces\home.json', 'jobs.json', 'logs\backend.log') {
        $file = Join-Path $ctx.StateDir $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $file -Parent) | Out-Null
        [System.IO.File]::WriteAllText($file, "stand-in for $rel`n", $Utf8)
    }
    New-Item -ItemType Directory -Force -Path $ctx.ConfigDir, $ctx.BackupRoot | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $ctx.ConfigDir 'settings.json'), ('{{"lab":{0}}}' -f (ConvertTo-Json (Join-Path $root 'lab'))) + "`n", $Utf8)
    [void](& $FakeInstaller $ctx $ctx.RollbackInstaller "/S /NS /D=$($ctx.Folder)")
    $ctx.Calls.Clear()
    return $ctx
}

function Remove-Fixture {
    param($Ctx)
    if ($Ctx.RegistryRoot -like "*\$SelfTestRegistryMark*" -and (Test-Path -LiteralPath $Ctx.RegistryRoot)) { Remove-Item -LiteralPath $Ctx.RegistryRoot -Recurse -Force }
    if ("$($Ctx.Root)".StartsWith((Join-Path $SelfTestRoot $SelfTestPrefix)) -and (Test-Path -LiteralPath $Ctx.Root)) { Remove-Item -LiteralPath $Ctx.Root -Recurse -Force }
}

function Get-FixtureDigest {
    # Registry values, every file and its hash under the fixture, and the install folder's DACL: any change shows.
    param($Ctx)
    $reg = @($Ctx.UninstallKey, $Ctx.FolderKey | ForEach-Object { "$(Get-RegistryValues $_ | ConvertTo-Json -Compress)" })
    $files = @(Get-ChildItem -LiteralPath $Ctx.Root -Recurse -Force | Sort-Object FullName | ForEach-Object { "$($_.FullName)|$(if ($_.PSIsContainer) { 'dir' } else { Get-Sha256 $_.FullName })" })
    return (($reg + $files + @((Get-AclFacts $Ctx.Folder).sddl)) -join "`n")
}

function Invoke-WithFixture {
    # Runs $Body with a fresh fixture (and $Arg) and always removes the fixture. Plain scriptblocks, never closures: a
    # closure would not see this script's functions.
    param([string]$Mode, [scriptblock]$Body, $Arg = $null)
    $ctx = New-Fixture $Mode
    try { & $Body $ctx $Arg } finally { Remove-Fixture $ctx }
}

function Test-Refused {
    # Does the preflight refuse with a problem that matches $Pattern?
    param($Ctx, [string]$Pattern)
    return (@((Invoke-Preflight $Ctx).problems | Where-Object { $_ -like $Pattern }).Count -gt 0)
}

function Test-PreflightSelfTest {
    Invoke-WithFixture 'ok' { param($c)
        $pre = Invoke-Preflight $c
        Expect 'a clean fixture passes the preflight (the control)' (@($pre.problems).Count -eq 0) ($pre.problems -join '; ')
        $c.ListProcesses = { @([pscustomobject]@{ id = 4242; parent = 1; name = 'nqt-selftest.exe'; path = (Join-Path $Ctx.Folder 'nqt-selftest.exe') }) }
        Expect 'the app running from the install folder is refused (born failing)' (Test-Refused $c 'the app is running*')
        $c.ListProcesses = { @([pscustomobject]@{ id = 4243; parent = 1; name = 'nqt-selftest.exe'; path = 'E:\elsewhere\nqt-selftest.exe' }) }
        Expect 'the app running from another folder is refused (born failing)' (Test-Refused $c 'the app is running*')
        [System.IO.File]::WriteAllText((Join-Path $c.StateDir $LockName), '{"v":1,"pid":4244,"port":1,"token":"never-printed","root":"x","started":0}', $Utf8)
        $c.ListProcesses = { @([pscustomobject]@{ id = 4244; parent = 1; name = 'python.exe'; path = 'C:\x\python.exe' }) }
        $live = @((Invoke-Preflight $c).problems)
        Expect 'a live backend behind backend.lock is refused (born failing)' (@($live | Where-Object { $_ -like 'a backend of this lab is running*' }).Count -gt 0)
        Expect 'the refusal never carries the lock token' ((($live -join ' ') -notlike '*never-printed*'))
        $c.ListProcesses = { @() }
        Expect 'a stale backend.lock (its process gone) is not a refusal' (@((Invoke-Preflight $c).problems).Count -eq 0)
        $c.ListProcesses = { @([pscustomobject]@{ id = 4245; parent = 1; name = 'python.exe'; path = 'C:\x\python.exe'; command = '"C:\x\python.exe" -m nq_terminal ' }) }
        Expect 'a terminal backend without a lock (python -m nq_terminal) is refused (born failing)' (Test-Refused $c 'a terminal backend is running*')
        $c.ListProcesses = { @([pscustomobject]@{ id = 4246; parent = 1; name = 'python.exe'; path = 'C:\x\python.exe'; command = '"C:\x\python.exe" -m nq_terminal_tools' }) }
        Expect 'another python module is not taken for a backend' (@((Invoke-Preflight $c).problems).Count -eq 0)
        $c.ListProcesses = { @() }
        Expect 'backend.lock is never in the manifest' (@((Invoke-Preflight $c).manifest | Where-Object { $_.path -eq $LockName }).Count -eq 0)
    }
    Invoke-WithFixture 'ok' { param($c)
        [System.IO.File]::AppendAllText($c.Installer, "tampered`n")
        Expect 'an installer whose hash does not match SHA256SUMS is refused (born failing)' (Test-Refused $c 'the new installer hashes to*')
        $c.Sha256 = Get-Sha256 $c.Installer
        Expect 'a matching -Sha256 still reports the stale SHA256SUMS line (born failing)' (Test-Refused $c 'SHA256SUMS beside the new installer lists*')
        Remove-Item -LiteralPath (Join-Path (Split-Path $c.Installer -Parent) 'SHA256SUMS')
        Expect 'a matching -Sha256 alone passes' (@((Invoke-Preflight $c).problems).Count -eq 0) ((Invoke-Preflight $c).problems -join '; ')
        $c.Sha256 = '0' * 64
        Expect 'a -Sha256 that does not match is refused (born failing)' (Test-Refused $c 'the new installer hashes to*')
        $c.Sha256 = ''
        Expect 'no SHA256SUMS and no -Sha256 is refused (born failing)' (Test-Refused $c 'no expected SHA256 for the new*')
    }
    Invoke-WithFixture 'ok' { param($c)
        $sums = Join-Path (Split-Path $c.Installer -Parent) 'SHA256SUMS'
        [System.IO.File]::WriteAllText($sums, ([System.IO.File]::ReadAllText($sums) -replace 'nqt selftest product', 'nqt.selftest.product'), $Utf8)
        Expect 'a SHA256SUMS line with the published dotted name is accepted' (@((Invoke-Preflight $c).problems).Count -eq 0) ((Invoke-Preflight $c).problems -join '; ')
        $measure = Join-Path (Split-Path $c.Installer -Parent) "$($c.Product) measure_0.1.2_x64-setup.exe"
        Copy-Item -LiteralPath $c.Installer -Destination $measure
        $c.Installer = $measure
        Expect 'a measure installer is refused as the new installer (born failing)' (Test-Refused $c '*is not*_<x.y.z>_x64-setup.exe*')
    }
    Invoke-WithFixture 'ok' { param($c)
        $c.RollbackInstaller = Join-Path $c.Root 'release\0.1.1\missing_0.1.1_x64-setup.exe'
        Expect 'a missing rollback installer is refused (born failing)' (Test-Refused $c 'the rollback installer * does not exist')
        $c.RollbackInstaller = ''
        Expect 'no rollback installer given is refused (born failing)' (Test-Refused $c 'the rollback installer is not given')
        $c.RollbackInstaller = $c.Installer
        Expect 'a rollback installer of another version is refused (born failing)' (Test-Refused $c 'the rollback installer is 0.1.2*')
        $c.Installer = $c.RollbackInstaller -replace '0\.1\.2', '0.1.1'
        Expect 'a new installer of the installed version is refused (born failing)' (Test-Refused $c 'version 0.1.1 is installed already*')
    }
    Invoke-WithFixture 'ok' { param($c)
        Set-ItemProperty -LiteralPath $c.FolderKey -Name '(default)' -Value (Join-Path $c.Root 'elsewhere')
        Expect 'a remembered folder that is not InstallLocation is refused (born failing)' (Test-Refused $c 'the folder the installer remembers*')
        $c.BackupRoot = Join-Path $c.StateDir 'backups'
        Expect 'a backup folder inside the state folder is refused (born failing)' (Test-Refused $c 'the backup folder * is inside *')
        Remove-Item -LiteralPath $c.UninstallKey -Recurse -Force
        Expect 'no install is refused (born failing)' (Test-Refused $c 'no install of*')
    }
}

function Test-StateFolderSelfTest {
    # The state folder is the one the app uses (lab from its settings), never one guessed from where the script runs.
    Invoke-WithFixture 'ok' { param($c)
        $other = Join-Path $c.Root 'elsewhere\state'
        $r = Resolve-StateFolder $c.ConfigDir '' '' $false
        Expect 'the state folder comes from the lab in the app settings (the control)' (($r.path -ieq $c.StateDir) -and (@($r.problems).Count -eq 0) -and ($r.source -like '*settings.json*')) "$($r.path) / $($r.source) / $(@($r.problems) -join '; ')"
        Expect 'the plan source names the lab folder' ($r.source -like "*$(Join-Path $c.Root 'lab')*") $r.source
        Expect 'the context state folder is the app one, not the script tree' (-not $c.StateDir.StartsWith($Terminal, [System.StringComparison]::OrdinalIgnoreCase))
        $r = Resolve-StateFolder $c.ConfigDir ($c.StateDir.ToUpperInvariant() + '\') '' $false
        Expect 'an explicit -StateDir equal to the app one (case, trailing slash) is accepted' (@($r.problems).Count -eq 0) (@($r.problems) -join '; ')
        $r = Resolve-StateFolder $c.ConfigDir $other '' $false
        Expect 'a -StateDir elsewhere is refused (born failing)' (@($r.problems | Where-Object { $_ -like '*not the one the app uses*' }).Count -eq 1) (@($r.problems) -join '; ')
        $r = Resolve-StateFolder $c.ConfigDir '' $other $false
        Expect 'an NQT_STATE_DIR elsewhere is refused (born failing)' (@($r.problems | Where-Object { $_ -like '*NQT_STATE_DIR*not the one the app uses*' }).Count -eq 1) (@($r.problems) -join '; ')
        $r = Resolve-StateFolder $c.ConfigDir '' $other $true
        Expect 'an explicit override takes the other folder and says so' (($r.path -ieq $other) -and (@($r.problems).Count -eq 0) -and ($r.source -like '*override*') -and ($r.source -like "*$($c.StateDir)*")) "$($r.path) / $($r.source)"
        $r = Resolve-StateFolder $c.ConfigDir $c.StateDir $other $false
        Expect 'an NQT_STATE_DIR elsewhere is ignored when -StateDir names the app folder' (@($r.problems).Count -eq 0) (@($r.problems) -join '; ')
        $settings = Join-Path $c.ConfigDir 'settings.json'
        Copy-Item -LiteralPath $settings -Destination "$settings.1"
        [System.IO.File]::WriteAllText($settings, '{ not json', $Utf8)
        $r = Resolve-StateFolder $c.ConfigDir '' '' $false
        Expect 'a corrupt settings.json falls back to settings.json.1' (($r.path -ieq $c.StateDir) -and ($r.source -like '*settings.json.1*')) "$($r.path) / $($r.source)"
        Remove-Item -LiteralPath $settings, "$settings.1" -Force
        $r = Resolve-StateFolder $c.ConfigDir '' '' $false
        Expect 'no readable settings and no -StateDir is refused (born failing)' ((-not $r.path) -and (@($r.problems | Where-Object { $_ -like '*cannot read the lab*' }).Count -eq 1)) (@($r.problems) -join '; ')
        $r = Resolve-StateFolder $c.ConfigDir '' $other $false
        Expect 'no readable settings with only NQT_STATE_DIR is refused (born failing)' (@($r.problems).Count -eq 1)
        $r = Resolve-StateFolder $c.ConfigDir $other '' $false
        Expect 'no readable settings with an explicit -StateDir takes it' (($r.path -ieq $other) -and (@($r.problems).Count -eq 0)) (@($r.problems) -join '; ')
    }
}

function Test-BackupSelfTest {
    Invoke-WithFixture 'ok' { param($c)
        $pre = Invoke-Preflight $c
        $dir = New-Backup $c $pre
        $fresh = @(Test-BackupCopy $dir $pre.manifest)
        Expect 'a fresh backup matches its manifest' ($fresh.Count -eq 0) ($fresh -join '; ')
        Expect 'the backup holds the install, state and config files and registry.json' ((Test-Path (Join-Path $dir 'install\nqt-selftest.exe')) -and (Test-Path (Join-Path $dir 'state\jobs.json')) -and (Test-Path (Join-Path $dir 'config\settings.json')) -and (Test-Path (Join-Path $dir 'registry.json')))
        [System.IO.File]::AppendAllText((Join-Path $dir 'state\workspaces\home.json'), 'flipped')
        Expect 'a changed backup copy is detected (born failing)' (@(Test-BackupCopy $dir $pre.manifest | Where-Object { $_ -eq 'changed: state\workspaces\home.json' }).Count -eq 1)
        Remove-Item -LiteralPath (Join-Path $dir 'install\uninstall.exe')
        Expect 'a missing backup copy is detected (born failing)' (@(Test-BackupCopy $dir $pre.manifest | Where-Object { $_ -eq 'missing: install\uninstall.exe' }).Count -eq 1)
        [System.IO.File]::AppendAllText((Join-Path $c.StateDir 'jobs.json'), 'live change')
        Expect 'a changed live state file is detected (born failing)' (@(Get-StateDifferences $c $pre | Where-Object { $_ -eq 'changed: state\jobs.json' }).Count -eq 1)
        [System.IO.File]::WriteAllText((Join-Path $c.ConfigDir 'new.json'), '{}')
        Expect 'an added config file is detected (born failing)' (@(Get-StateDifferences $c $pre | Where-Object { $_ -eq 'added: config\new.json' }).Count -eq 1)
        Expect 'equal manifests give no difference' (@(Compare-Manifest $pre.manifest $pre.manifest @('install', 'state', 'config')).Count -eq 0)
    }
    Invoke-WithFixture 'ok' { param($c)
        $pre = Invoke-Preflight $c
        $dir = New-Backup $c $pre
        $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $acl = @(Get-PrincipalProblems (Get-AclFacts $dir) $user)
        Expect 'the backup folder is private to the user, SYSTEM and Administrators (born failing)' ($acl.Count -eq 0) ($acl -join '; ')
        $planted = Join-Path $dir 'config\settings.json'
        [System.IO.File]::WriteAllText($planted, "{`"lab`":`"planted`"}`n", $Utf8)
        $plantedHash = Get-Sha256 $planted
        [System.IO.File]::AppendAllText((Join-Path $c.ConfigDir 'settings.json'), 'live change')
        [System.IO.File]::AppendAllText((Join-Path $c.StateDir 'jobs.json'), 'live change')
        $restore = Restore-State $c $pre $dir
        Expect 'a changed backup copy never reaches the live folder (born failing)' ((Get-Sha256 (Join-Path $c.ConfigDir 'settings.json')) -ne $plantedHash)
        Expect 'a refused backup copy is named as a restore problem (born failing)' (@($restore.problems | Where-Object { $_ -eq 'changed: config\settings.json' }).Count -eq 1) ($restore.problems -join '; ')
        Expect 'the refusal is written in the notes' (@($restore.notes | Where-Object { $_ -like 'refused*config\settings.json*' }).Count -eq 1) ($restore.notes -join '; ')
        Expect 'a matching backup copy is still restored beside the refused one' ((Get-Sha256 (Join-Path $c.StateDir 'jobs.json')) -eq (@($pre.manifest | Where-Object { $_.area -eq 'state' -and $_.path -eq 'jobs.json' })[0].sha256))
    }
}

function Test-RollbackCase {
    param($c, $Case)
    $stateBefore = @(Get-Manifest (Get-Areas $c $c.Folder) | Where-Object { $_.area -ne 'install' })
    $r = Invoke-Upgrade $c $true
    $back = (Get-InstallFacts $c).version -eq '0.1.1'
    $exe = [System.IO.File]::ReadAllText((Join-Path $c.Folder 'nqt-selftest.exe')).Trim()
    $stateSame = @(Compare-Manifest $stateBefore @(Get-Manifest (Get-Areas $c $c.Folder)) @('state', 'config')).Count -eq 0
    $acl = @(Get-DaclProblems $c.Folder 'nqt-selftest').Count -eq 0
    $ok = ($r.status -eq 'rolled-back') -and $back -and ($exe -like '*0.1.1') -and $stateSame -and $acl -and ((Get-ExitCode $r) -eq $ExitRolledBack)
    Expect $Case.name $ok "$($r.status); version back $back; exe '$exe'; state same $stateSame; acl $acl; $($r.problems -join '; ') || $($r.rollback -join '; ')"
    $calls = "install 0.1.2 /S /NS|uninstall $($c.Folder)|install 0.1.1 /S /NS /D=$($c.Folder)"
    Expect "$($Case.mode): the rollback uninstalled the new version and reinstalled 0.1.1 into the same folder" (($c.Calls -join '|') -eq $calls) ($c.Calls -join '|')
}

function Test-UpgradeSelfTest {
    Invoke-WithFixture 'ok' { param($c)
        $before = Get-FixtureDigest $c
        $r = Invoke-Upgrade $c $false
        Expect 'a dry run reports dry-run and calls no installer' ($r.status -eq 'dry-run' -and $c.Calls.Count -eq 0) "$($r.status) $($c.Calls -join ', ')"
        Expect 'a dry run changes nothing (registry, files, DACL)' ($before -eq (Get-FixtureDigest $c))
        $r = Invoke-Upgrade $c $true
        Expect 'a good upgrade ends upgraded at 0.1.2 without a rollback' ($r.status -eq 'upgraded' -and (Get-InstallFacts $c).version -eq '0.1.2' -and @($r.rollback).Count -eq 0) "$($r.status): $($r.problems -join '; ')"
        Expect 'the upgrade ran the new installer once, silently, with no /D=' (($c.Calls -join '|') -eq 'install 0.1.2 /S /NS') ($c.Calls -join '|')
        Expect 'the upgrade wrote a report into the backup folder' (Test-Path -LiteralPath (Join-Path $r.backup 'upgrade-report.json'))
        Expect 'exit code 0 for an upgrade' ((Get-ExitCode $r) -eq $ExitOk)
    }
    $cases = @(
        @{ mode = 'fail-exit'; name = 'a failed install (exit code 1, a half-written exe) is rolled back (born failing)' },
        @{ mode = 'no-version-bump'; name = 'an install that leaves the old DisplayVersion is rolled back (born failing)' },
        @{ mode = 'bad-acl'; name = 'an install that leaves Authenticated Users Modify on the folder is rolled back (born failing)' },
        @{ mode = 'touch-state'; name = 'an install that changes a state file is rolled back and the file restored (born failing)' })
    foreach ($case in $cases) { Invoke-WithFixture $case.mode { param($c, $Case) Test-RollbackCase $c $Case } $case }
    Invoke-WithFixture 'refused-untouched' { param($c)
        $r = Invoke-Upgrade $c $true
        $unchanged = @($r.rollback | Where-Object { $_ -like 'the install is unchanged*' }).Count -eq 1
        Expect 'an installer that refuses (exit 3) and writes nothing is reported, and nothing is reinstalled' ($r.status -eq 'rolled-back' -and ($c.Calls -join '|') -eq 'install 0.1.2 /S /NS' -and $unchanged) "$($r.status) $($c.Calls -join '|')"
    }
    Invoke-WithFixture 'fail-exit' { param($c)
        $c.RunInstaller = { param($Ctx, $Path, $ArgumentText) if ($Path -eq $Ctx.Installer) { return & $FakeInstaller $Ctx $Path $ArgumentText } $Ctx.Calls.Add('rollback install fails'); return 1 }
        $r = Invoke-Upgrade $c $true
        Expect 'a rollback whose reinstall fails says so (exit code 5)' ($r.status -eq 'rollback-failed' -and (Get-ExitCode $r) -eq $ExitRollbackFailed) "$($r.status)"
    }
    Invoke-WithFixture 'throw-after-install' { param($c)
        $r = [ordered]@{ status = 'threw'; backup = ''; error = ''; problems = @(); rollback = @() }; $escaped = ''
        try { $r = Invoke-Upgrade $c $true } catch { $escaped = $_.Exception.Message }
        $back =(Get-InstallFacts $c).version -eq '0.1.1'
        $reported = $r -and $r.backup -and (Test-Path -LiteralPath (Join-Path $r.backup 'upgrade-report.json'))
        Expect 'an error after the installer ran is rolled back, reported and exits 4, never 1 (born failing)' ($r -and $r.status -eq 'rolled-back' -and $back -and $reported -and (Get-ExitCode $r) -eq $ExitRolledBack -and "$($r.error)" -like '*simulated failure after the installer ran*') "escaped '$escaped'; $($r.status); version back $back; reported $reported; $($c.Calls -join '|'); $(@($r.problems) -join '; ')"
        Expect 'that rollback uninstalled the new version and reinstalled 0.1.1' (($c.Calls -join '|') -eq "install 0.1.2 /S /NS|uninstall $($c.Folder)|install 0.1.1 /S /NS /D=$($c.Folder)") ($c.Calls -join '|')
    }
    Invoke-WithFixture 'throw-after-install' { param($c)
        $c.RunUninstaller = { param($Ctx, $Folder) throw 'simulated uninstaller crash' }
        $r = [ordered]@{ status = 'threw'; backup = ''; error = ''; problems = @(); rollback = @() }; $escaped = ''
        try { $r = Invoke-Upgrade $c $true } catch { $escaped = $_.Exception.Message }
        $reported =$r -and $r.backup -and (Test-Path -LiteralPath (Join-Path $r.backup 'upgrade-report.json'))
        Expect 'an error after the installer ran and a rollback that also throws is reported and exits 5 (born failing)' ($r -and $r.status -eq 'rollback-failed' -and $reported -and (Get-ExitCode $r) -eq $ExitRollbackFailed) "escaped '$escaped'; $($r.status); reported $reported"
    }
    Invoke-WithFixture 'ok' { param($c)
        $c.Installer = 'C:\Users\someone\real_0.1.2_x64-setup.exe'
        $threw = $false
        try { [void](& $FakeInstaller $c $c.Installer '/S /NS') } catch { $threw = $true }
        Expect 'the fake installer refuses a context that points outside the self-test folder (born failing)' $threw
    }
}

function Test-RunTempSelfTest {
    # The installer and the uninstaller run NSIS plugin DLLs out of TEMP, so TEMP must be a fresh folder only this user,
    # SYSTEM and Administrators can write, never the shared parent that inherits Authenticated Users Modify.
    Invoke-WithFixture 'ok' { param($c)
        $parent = $c.TempDir
        $c.RunInstaller = { param($Ctx, $Path, $ArgumentText)
            $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            $Ctx.TempSeen = $Ctx.TempDir
            $Ctx.TempProblems = @(Get-PrincipalProblems (Get-AclFacts $Ctx.TempDir) $user)
            return & $FakeInstaller $Ctx $Path $ArgumentText
        }
        $r = Invoke-Upgrade $c $true
        $seen = "$($c.TempSeen)"
        Expect 'the installer ran with TEMP in a fresh sub-folder of the shared temp folder (born failing)' ($seen -and $seen -ne $parent -and $seen.StartsWith($parent + '\', [System.StringComparison]::OrdinalIgnoreCase)) $seen
        Expect 'that TEMP folder had a protected DACL (user, SYSTEM, Administrators only) while the installer ran (born failing)' (@($c.TempProblems).Count -eq 0) (@($c.TempProblems) -join '; ')
        Expect 'the run folder is deleted afterwards and the context is restored' ($r.status -eq 'upgraded' -and -not (Test-Path -LiteralPath $seen) -and $c.TempDir -eq $parent) "$($r.status) $seen"
    }
    Invoke-WithFixture 'ok' { param($c)
        $existing = Join-Path $c.TempDir "run-$($c.Stamp)"
        New-Item -ItemType Directory -Force -Path $existing | Out-Null
        $r = Invoke-Upgrade $c $true
        Expect 'a run folder that already exists is refused and no installer is called (born failing)' ($r.status -eq 'refused' -and $c.Calls.Count -eq 0 -and (Test-Path -LiteralPath $existing)) "$($r.status) $($c.Calls -join ', ')"
    }
}

function Test-LiveProcessSelfTest {
    # A real hidden process started from the fake install folder must be found by the real process list.
    Invoke-WithFixture 'ok' { param($c)
        $exe = Join-Path $c.Folder 'nqt-selftest-sleeper.exe'
        New-Item -ItemType Directory -Force -Path $c.TempDir | Out-Null
        $env:TEMP = $c.TempDir; $env:TMP = $c.TempDir
        Add-Type -TypeDefinition 'public static class NqtUpgradeSleeper { public static void Main() { System.Threading.Thread.Sleep(60000); } }' -OutputAssembly $exe -OutputType ConsoleApplication
        $c.ListProcesses = { @(Get-SystemProcesses | Where-Object { $_.path -and $_.path.StartsWith($Ctx.Root, [System.StringComparison]::OrdinalIgnoreCase) }) }
        Expect 'with nothing running from the folder the live check finds nothing' (@(Get-AppProblems $c $c.Folder).Count -eq 0)
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $exe; $info.UseShellExecute = $false; $info.CreateNoWindow = $true; $info.WorkingDirectory = $c.TempDir
        $proc = [System.Diagnostics.Process]::Start($info)
        try {
            $seen = $false
            for ($i = 0; $i -lt 20 -and -not $seen; $i++) { $seen = @(Get-AppProblems $c $c.Folder).Count -gt 0; if (-not $seen) { Start-Sleep -Milliseconds 250 } }
            Expect 'a real process from the install folder is refused (born failing)' $seen
        } finally { if (-not $proc.HasExited) { $proc.Kill(); [void]$proc.WaitForExit(5000) } }
    }
}

function Invoke-SelfTest {
    $saved = @($env:TEMP, $env:TMP)
    try {
        Test-PreflightSelfTest
        Test-StateFolderSelfTest
        Test-BackupSelfTest
        Test-UpgradeSelfTest
        Test-RunTempSelfTest
        Test-LiveProcessSelfTest
    } finally { $env:TEMP, $env:TMP = $saved }
    $left = @(Get-ChildItem -LiteralPath $SelfTestRoot -Directory -Filter "$SelfTestPrefix*" -ErrorAction SilentlyContinue) + @(Get-ChildItem -LiteralPath $RealRegistryRoot -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like "$SelfTestRegistryMark*" })
    Expect 'no fixture folder or fake registry root is left' ($left.Count -eq 0) (@($left | ForEach-Object { $_.Name }) -join ', ')
    $failed = @($SelfResults | Where-Object { -not $_.passed })
    Write-Host ("upgrade-owner self-test: {0} checks, {1} failed" -f $SelfResults.Count, $failed.Count)
    $script:SelfExit = if ($failed.Count -eq 0) { 0 } else { 1 }
}

# ---- main ------------------------------------------------------------------------------------------------------------------

if ($SelfTest) {
    $script:SelfExit = 1
    Invoke-SelfTest | Out-Host
    exit $script:SelfExit
}
if (-not $Installer -and -not $RollbackInstaller) {
    Write-Host 'give -Installer <new setup exe> and -RollbackInstaller <installed version''s setup exe> for a dry run, add -Go to upgrade; or -SelfTest'
    exit $ExitUsage
}
$config = if ($ConfigDir) { $ConfigDir } else { Join-Path $env:APPDATA $Identifier }
$resolved = Resolve-StateFolder $config $StateDir $env:NQT_STATE_DIR ([bool]$AllowStateOverride)
if ($resolved.problems.Count -gt 0) {
    foreach ($p in $resolved.problems) { Write-Host "  REFUSE  $p" }
    Write-Host 'refused: nothing was changed. 1 problem(s) above.'
    exit $ExitRefused
}
$spec = @{
    RegistryRoot = $RealRegistryRoot; ProductName = $Product; ManufacturerName = $Manufacturer; Binary = $MainBinary
    State = $resolved.path; StateSource = $resolved.source; Config = $config; Backups = $BackupRoot; Temp = $RunTemp
    NewInstaller = $Installer; NewHash = $Sha256; OldInstaller = $RollbackInstaller; OldHash = $RollbackSha256
}
$result = Invoke-Upgrade (New-Context @spec) ([bool]$Go)
Write-Outcome $result
exit (Get-ExitCode $result)
