<#
.SYNOPSIS
  Silent per-user install and uninstall of a Tauri NSIS installer, with the window watch on (04 D5.4, D5.1).

.DESCRIPTION
  powershell -NoProfile -File desktop\scripts\install-test.ps1 -Installer D:\dev\release\0.2.1\<name>_0.2.1_x64-setup.exe
  powershell -NoProfile -File desktop\scripts\install-test.ps1 -SelfTest [-Installer <installer>]

  The install goes to <InstallRoot>\<Run> (default D:\dev\d5\install\<run>), never anywhere else, and the app is
  never started. Steps and what each asserts:
    1. The generated installer.nsi (found beside the installer: nsis\<build>\installer.nsi) is read: INSTALLMODE
       currentUser (no admin), the /NS no-shortcut switch exists (the script makes a desktop shortcut for every
       silent install without it), and /R is the only way the app is started after an install. The flags used are
       /S /NS /D=<folder>; the run folder must not exist yet.
    2. Refusals: a target outside D:\dev, a non-empty target, and any existing registry entry of the same product
       (HKCU or HKLM Uninstall key, HKCU Software\<manufacturer>\<product>), because the installer would then run
       the old uninstaller, which could be the owner's real install.
    3. The installer starts with CreateProcess (no shell), so an installer that asked for elevation fails with
       error 740 instead of showing a UAC prompt: "no admin prompt" is asserted by the install succeeding. Its
       TEMP is D:\dev\tmp, so nothing is written on C:.
    4. After the install: the main exe, WebView2Loader.dll and uninstall.exe are in the folder; the main exe is the
       one the release folder's payload holds (when it is there); no lab-data path (artefact-check.mjs --tree); no
       desktop shortcut and no start menu shortcut; the HKCU uninstall entry exists with the folder as
       InstallLocation and no HKLM entry; the app is not running (no process runs from the folder). The folder's ACL
       is asserted: the script creates the run folder first with inheritance removed and full control for the current
       user, SYSTEM and Administrators only (the layout of the default %LOCALAPPDATA% target, not D:\dev's inherited
       Authenticated Users: Modify), and after the install neither the folder nor the exe, WebView2Loader.dll or
       uninstall.exe may carry an Allow rule that lets Everyone, Users or Authenticated Users write, delete or change
       permissions (matched by SID). The parent folder's ACL is recorded in the report as the contrast.
    5. The silent uninstall runs (it copies itself to TEMP and returns early, so the script waits for its process and
       the folder to go): no file is left, the HKCU uninstall entry is gone, no shortcut is left. The silent
       uninstaller leaves HKCU\Software\<manufacturer>\<product> (the install folder, kept for the next install); the
       script records that and removes it, because it created it.
    6. A global window watch (EnumWindows every 100 ms over every process, plus GetForegroundWindow) runs through the
       install and the uninstall: any new visible top-level window anywhere, or a change of foreground window, fails
       the run, with the window's process and title in the report. -AllowForeign downgrades those that belong to
       another program (not the installer, its folders or children) to warnings.
    7. Custom install folders (installer hooks, windows\nsis\hooks.nsh; CWE-427 and CWE-732), after the default layout:
       a folder under <CustomRoot>\<run>-custom whose parent grants Users Modify and Everyone write, NOT pre-protected,
       must end with exactly the current user, SYSTEM and Administrators as Allow rules, inheritance removed and no
       inherited rule, and no broad writer on the exe, the loader or the uninstaller. A lab stand-in beside it and a file
       the user adds inside it must survive the uninstall (only what the installer wrote is removed).
    8. Refusals, each expecting exit code 3, no registry entry and nothing written where the target points: a drive root
       (a SUBST drive onto a scratch folder, in three spellings), a network (UNC) path, a junction, and folders under
       Program Files and Windows (not run when elevated). An installer without the guard fails these: NSIS silently
       falls back to the default folder for a /D= it rejects, which this script then removes (nothing existed there).
    9. The real install guard (every run, any product): before and after the run the script hashes the values of the
       real product's HKCU uninstall key and of HKCU\Software\<manufacturer>\<real product>, and lists the real install
       folder (InstallLocation, else %LOCALAPPDATA%\Programs\<real product>: every file with size, time and sha256, plus
       the folder's SDDL). Any difference fails the run. The real state folder (%APPDATA%\<real identifier>) is listed
       too, but a change there is only a note, because the owner's running app may write its settings. The real
       product is the productName and identifier of src-tauri\tauri.conf.json.
   10. Renamed product. When the real product is installed (its HKCU key exists) or its state folder exists, the
       installer under test must be another product: a PRODUCTNAME or BUNDLEID equal to the real one is refused before
       anything is installed. src-tauri\tauri.installtest.conf.json is the overlay (productName "nq-lab terminal
       installtest", identifier dev.nqlab.terminal.installtest) over the same tauri.conf.json and the same NSIS hooks,
       so its uninstall key, install folder, %APPDATA% and %LOCALAPPDATA% folders, shortcuts and Run value are its own.
  -Upgrade (with -FromInstaller, the older installer of the same renamed product) replaces steps 4 to 8 with the upgrade
  scenario (release research section 3.3): stand-in state is seeded (the variant's settings.json and settings.json.1
  under %APPDATA%\<identifier>, a webview stand-in under %LOCALAPPDATA%\<identifier>, a lab with terminal\state
  workspaces and jobs.json under <CustomRoot>), then, each from a fresh old install with /S /NS /D=<folder>:
    a. a file of the user's in the folder makes the new installer refuse (exit 3, version unchanged); then the upgrade
       /S /NS /D=<folder>;
    b. the upgrade /S /NS /UPDATE /D=<folder> (the updater's quiet mode, without its window);
    c. the upgrade /S /NS with no /D= (the remembered folder), then the downgrade back to the old version over the top
       /S /NS /D=<folder> (allowed and not stopped, handover section 4).
  After each: exit 0, DisplayVersion and InstallLocation, the installed exe is the payload exe of that build, the file
  list is exactly what the old install had, the folder holds exactly the user, SYSTEM and Administrators with nothing
  inherited and no broad writer, no shortcut, the app not started, and the stand-in state hashes as seeded. After each
  uninstall: no file left, the uninstall entry gone, the stand-in state unchanged (the silent uninstaller keeps data).
  The seeded state is removed at the end. The old version must be strictly lower than the new one.
  -BuildRenamed <ref> builds the renamed-product installer of a git ref (a tag such as desktop-v0.2.1, or HEAD) in a
  temporary detached worktree under D:\dev\wt, with CARGO_TARGET_DIR -TargetDir (default D:\dev\targets\v012), into
  <BuildOut>\<version>-<commit>\ laid out as build-release.ps1 lays out a release folder (installer, nsis\installtest,
  payload\installtest, BUILD.json); -BuildVersion sets a higher version for the build (an upgrade target from a tree
  that still carries the old version). An existing folder whose BUILD.json names the same commit, version and overlay
  is reused. The worktree is removed afterwards (git worktree remove; --force only when the folder holds no junction
  or other reparse point). It installs nothing.
  Every run but -SelfTest and -BuildRenamed writes a stamped record, <RecordDir>\<date>_install.json or
  <date>_upgrade.json (default RecordDir terminal\state\release): version, product, identifier, installer name and
  sha256 (and the old installer's for an upgrade), steps passed and failed, the real install guard's result and the
  provenance stamp of the tree (record_green.ps1 -Stamp: HEAD, sha256 of git diff HEAD, sha256 of the untracked files).
  release_check.ps1 -RequireInstall refuses a tag without a passing record of both scenarios for an installer of its
  release folder.
  The file is above the 800-line soft ceiling on purpose: one script owns one runnable scenario list and its self-test.
  Writes <InstallRoot>\<Run>.report.json and exits 0 only when every assertion holds.
.PARAMETER Installer
  The NSIS installer (a wildcard that matches one file is fine).
.PARAMETER DefaultFolder
  Also installs once with no /D= into the bundler's default, which the hooks move to %LOCALAPPDATA%\Programs\<product>, checks
  the folder is protected, uninstalls and removes what is left. It writes about 3 MB under the user's profile on C: for a few
  seconds, so it is a switch of its own; it refuses to run when the product is already installed there.
.PARAMETER SelfTest
  Born-failing checks of the guards (the script reader, the target refusals, the window diff, the real install guard on
  a fake registry root and folder, the identity and version refusals, the record) and a short live run of the
  watcher; installs nothing.
.PARAMETER RealUninstallRoot, RealManufacturerRoot, RealStateRoot, RealProgramsRoot
  Where the real product's uninstall key, manufacturer key, state folder and default install folder are looked up
  (defaults: HKCU Uninstall, HKCU\Software\nqlab, %APPDATA%, %LOCALAPPDATA%\Programs). Test hooks only
  (desktop\scripts\tests\install-test.tests.ps1 points them at fake roots); a run that moves one says so.
#>
[CmdletBinding()]
param(
    [string]$Installer = '',
    [string]$InstallRoot = 'D:\dev\d5\install',
    [string]$Run = '',
    [string]$CustomRoot = 'D:\dev\tmp\dec1-apps',
    [switch]$AllowForeign,
    [switch]$DefaultFolder,
    [switch]$SelfTest,
    [switch]$Upgrade,
    [string]$FromInstaller = '',
    [string]$BuildRenamed = '',
    [string]$BuildVersion = '',
    [string]$BuildOut = 'D:\dev\release-installtest',
    [string]$TargetDir = 'D:\dev\targets\v012',
    [string]$RecordDir = '',
    [string]$RealUninstallRoot = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    [string]$RealManufacturerRoot = 'Registry::HKEY_CURRENT_USER\Software\nqlab',
    [string]$RealStateRoot = '',
    [string]$RealProgramsRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Terminal = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Crate = Join-Path $Terminal 'desktop\src-tauri'
$OverlayFile = Join-Path $Crate 'tauri.installtest.conf.json'
$WorktreeRoot = 'D:\dev\wt'
$ScratchBase = 'D:\dev\tmp\install-test'
$ScratchTemp = Join-Path $ScratchBase ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + "-$PID")
$AllowedRoot = 'D:\dev\'
$InstallTimeoutSec = 180
$BundleMarkerBytes = 8
$RefusedExitCode = 3
$UninstallTimeoutSec = 120
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Results = New-Object System.Collections.Generic.List[object]

if (-not ('NqtWindowWatch' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class NqtWindowWatch
{
    private delegate bool EnumProc(IntPtr h, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder s, ref uint size);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);

    private static Thread worker;
    private static volatile bool stopping;
    private static readonly object gate = new object();
    private static List<string> events = new List<string>();

    public static long[] VisibleHandles()
    {
        List<long> found = new List<long>();
        EnumWindows(delegate (IntPtr h, IntPtr l) { if (IsWindowVisible(h)) found.Add(h.ToInt64()); return true; }, IntPtr.Zero);
        return found.ToArray();
    }

    // Byte differences between two files of one length (-1 when the lengths differ).
    public static int CountDifferences(string a, string b)
    {
        byte[] x = System.IO.File.ReadAllBytes(a);
        byte[] y = System.IO.File.ReadAllBytes(b);
        if (x.Length != y.Length) return -1;
        int n = 0;
        for (int i = 0; i < x.Length; i++) { if (x[i] != y[i]) n++; }
        return n;
    }

    // The handles in `now` that are not in `baseline`: the new visible windows.
    public static long[] NewVisible(long[] baseline, long[] now)
    {
        HashSet<long> known = new HashSet<long>(baseline);
        List<long> fresh = new List<long>();
        foreach (long h in now) { if (!known.Contains(h)) fresh.Add(h); }
        return fresh.ToArray();
    }

    // A change of foreground window; a momentary null (windows being switched) is not a change.
    public static bool ForegroundChanged(long before, long now) { return now != 0 && now != before; }

    public static string Describe(long hwnd)
    {
        IntPtr h = new IntPtr(hwnd);
        uint pid; GetWindowThreadProcessId(h, out pid);
        StringBuilder title = new StringBuilder(256); GetWindowText(h, title, 256);
        StringBuilder cls = new StringBuilder(256); GetClassName(h, cls, 256);
        RECT r; GetWindowRect(h, out r);
        string exe = "";
        IntPtr proc = OpenProcess(0x1000, false, pid);
        if (proc != IntPtr.Zero)
        {
            StringBuilder path = new StringBuilder(1024); uint size = 1024;
            if (QueryFullProcessImageName(proc, 0, path, ref size)) exe = path.ToString();
            CloseHandle(proc);
        }
        return hwnd + "|" + pid + "|" + exe + "|" + cls + "|" + title + "|" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom;
    }

    public static void Start()
    {
        lock (gate) { events = new List<string>(); }
        stopping = false;
        long[] baseline = VisibleHandles();
        long foreground = GetForegroundWindow().ToInt64();
        worker = new Thread(delegate ()
        {
            HashSet<long> seen = new HashSet<long>(baseline);
            long last = foreground;
            while (!stopping)
            {
                foreach (long h in NewVisible(new List<long>(seen).ToArray(), VisibleHandles()))
                {
                    seen.Add(h);
                    lock (gate) { events.Add("window|" + Describe(h)); }
                }
                long now = GetForegroundWindow().ToInt64();
                if (ForegroundChanged(last, now))
                {
                    lock (gate) { events.Add("foreground|" + Describe(now)); }
                    last = now;
                }
                Thread.Sleep(100);
            }
        });
        worker.IsBackground = true;
        worker.Start();
    }

    public static string[] Stop()
    {
        stopping = true;
        if (worker != null) worker.Join(5000);
        lock (gate) { return events.ToArray(); }
    }
}
'@
}

function Add-Result {
    param([string]$Name, [bool]$Passed, [string]$Detail)
    $Results.Add([pscustomobject]@{ step = $Name; passed = $Passed; detail = $Detail })
    $mark = if ($Passed) { 'PASS' } else { 'FAIL' }
    Write-Host ("{0}  {1}  {2}" -f $mark, $Name, $Detail)
}

# ---- reading the generated installer script ------------------------------------------------------------------------

function Read-InstallerScript {
    # The facts install-test depends on, from the text of installer.nsi (a pure function, so it can be tested).
    param([string]$Text)
    $get = { param($name) $m = [regex]::Match($Text, '(?m)^\s*!define\s+' + $name + '\s+"([^"]*)"'); if ($m.Success) { $m.Groups[1].Value } else { '' } }
    $product = & $get 'PRODUCTNAME'
    return [pscustomobject]@{
        Product = $product
        Manufacturer = (& $get 'MANUFACTURER')
        MainBinary = (& $get 'MAINBINARYNAME')
        Version = (& $get 'VERSION')
        BundleId = (& $get 'BUNDLEID')
        InstallMode = (& $get 'INSTALLMODE')
        HasNoShortcutSwitch = [bool]([regex]::IsMatch($Text, 'GetOptions\}?\s+\$CMDLINE\s+"/NS"'))
        RunsAppOnlyWithR = [bool]([regex]::IsMatch($Text, 'GetOptions\}?\s+\$CMDLINE\s+"/R"'))
    }
}

function Get-ScriptProblems {
    param($Script)
    $out = @()
    if ($Script.Product -eq '') { $out += 'installer.nsi names no PRODUCTNAME' }
    if ($Script.InstallMode -ne 'currentUser') { $out += "INSTALLMODE is '$($Script.InstallMode)', not currentUser" }
    if (-not $Script.HasNoShortcutSwitch) { $out += 'the installer script has no /NS switch (a silent install would create a desktop shortcut)' }
    if (-not $Script.RunsAppOnlyWithR) { $out += 'the installer script has no /R switch, so what starts the app after an install is unknown' }
    return ,@($out)
}

function Find-InstallerScript {
    param([string]$InstallerPath)
    $dir = Split-Path $InstallerPath -Parent
    $product = ((Split-Path $InstallerPath -Leaf) -replace '_[0-9][0-9.]*_x64-setup\.exe$', '')
    foreach ($candidate in @(Get-ChildItem (Join-Path $dir 'nsis') -Recurse -Filter installer.nsi -ErrorAction SilentlyContinue)) {
        $read = Read-InstallerScript (Get-Content -Raw -Path $candidate.FullName -Encoding UTF8)
        if ($read.Product -eq $product) { return $candidate.FullName }
    }
    return $null
}

# ---- refusals --------------------------------------------------------------------------------------------------------

function Get-ProductKeys {
    param($Script)
    return @(
        "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($Script.Product)",
        "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($Script.Product)",
        "Registry::HKEY_CURRENT_USER\Software\$($Script.Manufacturer)\$($Script.Product)")
}

function Get-TargetProblems {
    param([string]$Target, [string[]]$ExistingKeys)
    $out = @()
    $full = [System.IO.Path]::GetFullPath($Target)
    if (-not $full.StartsWith($AllowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { $out += "the target $full is outside $AllowedRoot" }
    if ((Test-Path -LiteralPath $full) -and @(Get-ChildItem -LiteralPath $full -Force -ErrorAction SilentlyContinue).Count -gt 0) { $out += "the target $full is not empty" }
    foreach ($key in $ExistingKeys) { $out += "the registry entry $key already exists (an existing install of this product: the installer would run its uninstaller)" }
    return ,@($out)
}

# ---- state snapshots -------------------------------------------------------------------------------------------------------

function Get-ShortcutNames {
    param($Script)
    $folders = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'),
        [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))
    $found = foreach ($f in $folders) {
        if ($f -and (Test-Path -LiteralPath $f)) { Get-ChildItem -LiteralPath $f -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*$($Script.Product)*" } | ForEach-Object { $_.FullName } }
    }
    return @($found | Where-Object { $_ })
}

function Get-ProcessesFrom {
    # Processes whose image lies under $Folder (the app must not be among them).
    param([string]$Folder)
    $prefix = $Folder.TrimEnd('\') + '\'
    return @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) })
}

function Get-BroadWriters {
    # Allow rules that let Everyone, Users or Authenticated Users (by SID, so a localised name cannot hide one) change or
    # replace what is in the folder: WriteData/CreateFiles, AppendData, DeleteSubdirectoriesAndFiles, Delete,
    # ChangePermissions or TakeOwnership. A pure function over the rules, so it can be tested.
    param($Rules)
    $broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
    $writeMask = 2 -bor 4 -bor 64 -bor 65536 -bor 262144 -bor 524288
    return @($Rules | Where-Object { $_.type -eq 'Allow' -and ($broadSids -contains $_.sid) -and (($_.mask -band $writeMask) -ne 0) })
}

function Get-AclReport {
    param([string]$Folder)
    $acl = Get-Acl -LiteralPath $Folder
    $rules = @($acl.Access | ForEach-Object {
        $sid = ''
        try { $sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $sid = '' }
        [ordered]@{ identity = "$($_.IdentityReference)"; sid = $sid; rights = "$($_.FileSystemRights)"; mask = [int]$_.FileSystemRights; type = "$($_.AccessControlType)"; inherited = $_.IsInherited } })
    $broad = Get-BroadWriters $rules
    return [ordered]@{ owner = "$($acl.Owner)"; sddl = $acl.Sddl; protected = $acl.AreAccessRulesProtected; rules = $rules
        writable_by_broad_groups = @($broad | ForEach-Object { "$($_.identity): $($_.rights)" }) }
}

function Protect-InstallFolder {
    # Creates the run folder the way the default per-user target looks (%LOCALAPPDATA%\<product>): inheritance removed,
    # full control for the current user, SYSTEM and Administrators only. The installer then creates the files inside
    # it and they inherit that. Without this the folder inherits whatever its parent grants (on D:\dev, Authenticated
    # Users: Modify), which is not the layout a per-user install has.
    param([string]$Folder)
    New-Item -ItemType Directory -Force -Path $Folder | Out-Null
    $dir = Get-Item -LiteralPath $Folder
    $acl = $dir.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
    $admins = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
    foreach ($sid in @($user, $system, $admins)) {
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    $dir.SetAccessControl($acl)
}

# The installer and the uninstaller run their plugin DLLs out of TEMP, so TEMP is a fresh run folder that only this user,
# SYSTEM and Administrators can write (the shared scratch folder inherits Authenticated Users: Modify from D:\dev). A
# run folder that already exists is refused; the folder is deleted when the script exits.
if (Test-Path -LiteralPath $ScratchTemp) { Write-Host "ERROR  the scratch folder $ScratchTemp already exists"; exit 2 }
Protect-InstallFolder $ScratchTemp
$env:TEMP = $ScratchTemp
$env:TMP = $ScratchTemp

function Test-InstallAcl {
    # The install folder and the files an attacker would replace must not be writable by any broad group. The ACL is
    # recorded in the report too.
    param([string]$Target, $Script)
    $names = @('', "$($Script.MainBinary).exe", 'WebView2Loader.dll', 'uninstall.exe')
    $bad = @()
    $folderReport = $null
    foreach ($name in $names) {
        $path = if ($name -eq '') { $Target } else { Join-Path $Target $name }
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $r = Get-AclReport $path
        if ($name -eq '') { $folderReport = $r }
        foreach ($w in $r.writable_by_broad_groups) { $bad += "$(if ($name -eq '') { '<folder>' } else { $name }): $w" }
    }
    $protectedNote = if ($null -ne $folderReport) { "owner $($folderReport.owner); inheritance removed: $($folderReport.protected)" } else { 'folder missing' }
    Add-Result 'install folder and binaries not writable by Everyone, Users or Authenticated Users' (($null -ne $folderReport) -and $bad.Count -eq 0) "$protectedNote; broad write: $($bad -join ' || ')"
    return $folderReport
}

# ---- the window watch ------------------------------------------------------------------------------------------------------

function Test-OursWindow {
    # A window event belongs to this run when its process lies under the install folder, the scratch TEMP, or is the
    # installer or one of its children; the rest is foreign.
    param([string]$Event, [string]$Folder, [int[]]$Tracked)
    $parts = $Event.Split('|')
    $procId = 0
    [void][int]::TryParse($parts[2], [ref]$procId)
    $exe = $parts[3]
    $own = @(@($Folder, $ScratchTemp) | Where-Object { $exe.StartsWith($_.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase) })
    return ($own.Count -gt 0) -or ($Tracked -contains $procId)
}

function Get-WatchFindings {
    param([string[]]$Events, [string]$Folder, [int[]]$Tracked)
    $ours = @(); $foreign = @()
    foreach ($e in $Events) { if (Test-OursWindow $e $Folder $Tracked) { $ours += $e } else { $foreign += $e } }
    return @{ ours = $ours; foreign = $foreign }
}

# ---- running the installer -------------------------------------------------------------------------------------------------

function Start-HiddenProcess {
    # CreateProcess without the shell, no window; an installer that wants elevation throws error 740 here.
    param([string]$File, [string]$ArgumentText)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = $ArgumentText
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WorkingDirectory = $ScratchTemp
    $info.EnvironmentVariables['TEMP'] = $ScratchTemp
    $info.EnvironmentVariables['TMP'] = $ScratchTemp
    return [System.Diagnostics.Process]::Start($info)
}

function Wait-Silently {
    # Waits for a process and, after it, for the detached children the NSIS uninstaller leaves; samples processes.
    param($Process, [int]$TimeoutSec, [string]$Folder, [System.Collections.Generic.List[int]]$Tracked, [System.Collections.Generic.List[string]]$AppSeen)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $Tracked.Add($Process.Id)
    while ((Get-Date) -lt $deadline) {
        foreach ($p in @(Get-CimInstance Win32_Process | Where-Object { $Tracked -contains [int]$_.ParentProcessId })) { if (-not $Tracked.Contains([int]$p.ProcessId)) { $Tracked.Add([int]$p.ProcessId) } }
        foreach ($p in Get-ProcessesFrom $Folder) { if ($p.Name -ieq 'nq-lab-terminal.exe') { $AppSeen.Add("$($p.ProcessId) $($p.ExecutablePath)") } }
        $alive = @($Tracked | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        if ($Process.HasExited -and $alive.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Invoke-Install {
    # $NoFolder: no /D= at all, so the installer takes its own default ($Target is then only where windows are expected).
    # $Extra: switches before /D= (/UPDATE for the updater's quiet mode); /D= always comes last.
    param([string]$InstallerPath, [string]$Target, [System.Collections.Generic.List[int]]$Tracked, $AppSeen, [switch]$NoFolder, [string]$Extra = '')
    $start = Get-Date
    $switches = ('/S /NS ' + $Extra).Trim()
    $arguments = if ($NoFolder) { $switches } else { "$switches /D=$Target" }
    try { $proc = Start-HiddenProcess $InstallerPath $arguments } catch {
        $code = if ($_.Exception.InnerException) { $_.Exception.InnerException.NativeErrorCode } else { 0 }
        return @{ ok = $false; code = -1; detail = "the installer could not start without elevation or failed to start: $($_.Exception.Message) (native error $code)"; seconds = 0 }
    }
    $done = Wait-Silently $proc $InstallTimeoutSec $Target $Tracked $AppSeen
    $seconds = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
    if (-not $done) { return @{ ok = $false; code = -1; detail = "the installer did not finish in $InstallTimeoutSec s"; seconds = $seconds } }
    return @{ ok = ($proc.ExitCode -eq 0); code = $proc.ExitCode; detail = "exit code $($proc.ExitCode) in $seconds s ($arguments)"; seconds = $seconds }
}

function Invoke-Uninstall {
    param([string]$Target, [System.Collections.Generic.List[int]]$Tracked, $AppSeen)
    $uninstaller = Join-Path $Target 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { return @{ ok = $false; detail = "no $uninstaller" } }
    $start = Get-Date
    $proc = Start-HiddenProcess $uninstaller '/S'
    $done = Wait-Silently $proc $UninstallTimeoutSec $Target $Tracked $AppSeen
    $gone = $false
    for ($i = 0; $i -lt 40 -and -not $gone; $i++) { $gone = -not (Test-Path -LiteralPath (Join-Path $Target 'nq-lab-terminal.exe')); if (-not $gone) { Start-Sleep -Milliseconds 250 } }
    return @{ ok = ($done -and $gone); detail = "exit code $($proc.ExitCode), processes finished: $done, exe removed: $gone, $([math]::Round(((Get-Date) - $start).TotalSeconds, 1)) s" }
}

# ---- the assertions --------------------------------------------------------------------------------------------------------

function Test-InstalledFolder {
    param([string]$Target, $Script, [string]$InstallerPath)
    $exe = Join-Path $Target "$($Script.MainBinary).exe"
    foreach ($name in "$($Script.MainBinary).exe", 'WebView2Loader.dll', 'uninstall.exe') {
        Add-Result "installed $name" (Test-Path -LiteralPath (Join-Path $Target $name)) $Target
    }
    if (-not (Test-Path -LiteralPath $exe)) { return }
    $files = @(Get-ChildItem -LiteralPath $Target -Recurse -File | ForEach-Object { $_.FullName.Substring($Target.Length).TrimStart('\') })
    Add-Result 'installed file list' $true ($files -join ', ')
    $payload = @(Get-ChildItem (Split-Path $InstallerPath -Parent) -Recurse -Filter "$($Script.MainBinary).exe" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\payload\\' })
    $same = @($payload | Where-Object { $d = [NqtWindowWatch]::CountDifferences($exe, $_.FullName); ($d -ge 0) -and ($d -le $BundleMarkerBytes) })
    $note = if ($payload.Count -eq 0) { 'no payload folder beside the installer, not compared' } else { "same as the payload exe of: $(@($same | ForEach-Object { Split-Path (Split-Path $_.FullName -Parent) -Leaf }) -join ', ') (the bundler stamps the bundle type into the installed copy, at most $BundleMarkerBytes bytes differ)" }
    Add-Result 'installed exe is a payload exe' (($payload.Count -eq 0) -or ($same.Count -gt 0)) $note
    $tree = & node (Join-Path $Here 'artefact-check.mjs') --tree $Target 2>&1
    Add-Result 'no lab data in the install' ($LASTEXITCODE -eq 0) (($tree | Select-Object -Last 1) -join ' ')
}

function Test-InstallRegistry {
    param($Script, [string]$Target, [bool]$ShouldExist)
    $keys = Get-ProductKeys $Script
    $user = Get-ItemProperty -LiteralPath $keys[0] -ErrorAction SilentlyContinue
    $machine = Test-Path -LiteralPath $keys[1]
    if ($ShouldExist) {
        $location = if ($null -ne $user) { "$($user.InstallLocation)".Trim('"') } else { '' }
        Add-Result 'HKCU uninstall entry' (($null -ne $user) -and ($location -ieq $Target)) "InstallLocation '$location'"
        Add-Result 'no HKLM uninstall entry' (-not $machine) "present: $machine"
    } else {
        Add-Result 'HKCU uninstall entry removed' ($null -eq $user) "present: $($null -ne $user)"
    }
}

function Test-NoShortcuts {
    param($Script, [string[]]$Before, [string]$Phase)
    $after = Get-ShortcutNames $Script
    $new = @($after | Where-Object { $Before -notcontains $_ })
    Add-Result "no shortcut ($Phase)" ($new.Count -eq 0) "new: $($new -join ', ')"
}

function Remove-LeftoverManufacturerKey {
    # The silent uninstaller keeps HKCU\Software\<manufacturer>\<product> (the install folder). The run created it.
    param($Script)
    $key = (Get-ProductKeys $Script)[2]
    $left = Test-Path -LiteralPath $key
    Add-Result 'leftover install-folder key' $true "left by the silent uninstaller: $left (removed by this script)"
    if ($left) { Remove-Item -LiteralPath $key -Recurse -Force }
    $parent = Split-Path $key -Parent
    if ((Test-Path -LiteralPath $parent) -and @(Get-ChildItem -LiteralPath $parent -ErrorAction SilentlyContinue).Count -eq 0) { Remove-Item -LiteralPath $parent -Force }
}

function Test-WatchResult {
    param([string[]]$Events, [string]$Phase, [string]$Folder, [int[]]$Tracked)
    $found = Get-WatchFindings $Events $Folder $Tracked
    $failing = @($found.ours) + $(if ($AllowForeign) { @() } else { @($found.foreign) })
    Add-Result "0 new visible windows, no foreground change ($Phase)" ($failing.Count -eq 0) "$(@($Events).Count) events; failing: $($failing -join ' || ')"
    if ($AllowForeign -and $found.foreign.Count -gt 0) { Write-Host "WARN  foreign windows during ${Phase}: $($found.foreign -join ' || ')" }
}

# ---- the run ---------------------------------------------------------------------------------------------------------------

function Invoke-InstallTest {
    param([string]$InstallerPath)
    $scriptPath = Find-InstallerScript $InstallerPath
    if (-not $scriptPath) { Add-Result 'installer script' $false "no nsis\<build>\installer.nsi beside $InstallerPath for this product"; return }
    $facts = Read-InstallerScript (Get-Content -Raw -Path $scriptPath -Encoding UTF8)
    $problems = Get-ScriptProblems $facts
    Add-Result 'installer script flags' ($problems.Count -eq 0) "$scriptPath; product '$($facts.Product)', $($problems -join '; ')"
    if ($problems.Count -gt 0) { return }
    $script:Tested = @{ to = $facts; to_path = $InstallerPath }
    $identity = Get-IdentityProblems $facts (Get-RealProduct) $false
    Add-Result 'a renamed product beside the real install' ($identity.Count -eq 0) "product '$($facts.Product)', identifier '$($facts.BundleId)'; $($identity -join '; ')"
    if ($identity.Count -gt 0) { return }
    $target = Join-Path $InstallRoot $Run
    $existing = @(Get-ProductKeys $facts | Where-Object { Test-Path -LiteralPath $_ })
    $refusals = Get-TargetProblems $target $existing
    Add-Result 'target and registry refusals' ($refusals.Count -eq 0) "$target; $($refusals -join '; ')"
    if ($refusals.Count -gt 0) { return }
    $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Add-Result 'this process is not elevated' (-not $elevated) "elevated: $elevated (a per-user install needs none)"
    $shortcuts = Get-ShortcutNames $facts
    $tracked = New-Object 'System.Collections.Generic.List[int]'
    $appSeen = New-Object 'System.Collections.Generic.List[string]'
    $parent = Split-Path $target -Parent
    $parentAcl = if (Test-Path -LiteralPath $parent) { Get-AclReport $parent } else { $null }
    $report = [ordered]@{ installer = $InstallerPath; target = $target; parent_acl = $parentAcl }
    Protect-InstallFolder $target

    [NqtWindowWatch]::Start()
    $install = Invoke-Install $InstallerPath $target $tracked $appSeen
    Add-Result 'silent install' $install.ok $install.detail
    if ($install.ok) {
        Test-InstalledFolder $target $facts $InstallerPath
        Test-InstallRegistry $facts $target $true
        Test-NoShortcuts $facts $shortcuts 'after install'
        Add-Result 'app not started' (@($appSeen).Count -eq 0 -and @(Get-ProcessesFrom $target).Count -eq 0) "seen: $($appSeen -join ', ')"
        $report['acl'] = Test-InstallAcl $target $facts
        $uninstall = Invoke-Uninstall $target $tracked $appSeen
        Add-Result 'silent uninstall' $uninstall.ok $uninstall.detail
        $left = @(if (Test-Path -LiteralPath $target) { Get-ChildItem -LiteralPath $target -Recurse -Force -File })
        Add-Result 'uninstall leaves no files' ($left.Count -eq 0) "left: $(@($left | ForEach-Object { $_.Name }) -join ', ')"
        if ((Test-Path -LiteralPath $target) -and $left.Count -eq 0) { Remove-Item -LiteralPath $target -Recurse -Force }
        Test-InstallRegistry $facts $target $false
        Test-NoShortcuts $facts $shortcuts 'after uninstall'
        Remove-LeftoverManufacturerKey $facts
    }
    $events = [NqtWindowWatch]::Stop()
    Test-WatchResult $events 'install and uninstall' $target $tracked.ToArray()
    $report['window_events'] = $events
    if ($install.ok) {
        $extra = Invoke-CustomFolderTests $InstallerPath $facts $elevated
        $report['custom_folder'] = $extra.custom
        $report['custom_window_events'] = $extra.window_events
    }
    $script:Report = $report
}

# ---- custom install folders (DEC1: the protected install folder, CWE-427 and CWE-732) ---------------------------------------

function Get-PrincipalProblems {
    # A protected install folder holds exactly the user, SYSTEM and Administrators as Allow rules, inheritance removed and
    # no inherited rule. A pure function over the report of Get-AclReport and the user's SID, so it can be tested.
    param($Report, [string]$UserSid)
    $out = @()
    if (-not $Report.protected) { $out += 'the folder still inherits from its parent' }
    $inherited = @($Report.rules | Where-Object { $_.inherited })
    if ($inherited.Count -gt 0) { $out += "inherited rules: $(@($inherited | ForEach-Object { $_.identity }) -join ', ')" }
    $expected = @(@($UserSid, 'S-1-5-18', 'S-1-5-32-544') | Sort-Object -Unique)
    $actual = @(@($Report.rules | ForEach-Object { $_.sid }) | Sort-Object -Unique)
    if (($actual -join ',') -ne ($expected -join ',')) { $out += "principals are [$($actual -join ', ')], expected [$($expected -join ', ')]" }
    if (@($Report.rules | Where-Object { $_.type -ne 'Allow' }).Count -gt 0) { $out += 'a rule that is not Allow' }
    return ,@($out)
}

function New-PlantedParent {
    # A folder whose rules hand Users Modify and Everyone write to everything created in it: the hostile parent a custom
    # install folder such as D:\Apps may sit under.
    param([string]$Folder)
    New-Item -ItemType Directory -Force -Path $Folder | Out-Null
    & (Join-Path $env:SystemRoot 'System32\icacls.exe') $Folder /grant '*S-1-5-32-545:(OI)(CI)M' '*S-1-1-0:(OI)(CI)W' /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not plant permissions on $Folder" }
}

function Get-TreeDigest {
    # One digest over the relative paths and contents of a folder: any added, changed or removed file changes it.
    param([string]$Folder)
    $lines = Get-ChildItem -LiteralPath $Folder -Recurse -Force -File | Sort-Object FullName | ForEach-Object {
        "$($_.FullName.Substring($Folder.Length)):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    return (-join ($lines | ForEach-Object { $_ + "`n" }))
}

function New-LabSentinel {
    # A stand-in for the lab beside the install folder, with the paths the real one has: the uninstaller must never touch it.
    param([string]$Folder)
    foreach ($relative in 'results\ledger.csv', 'data\raw\NQ.V.0\1m\is_2010.parquet', 'terminal\state\workspace.json', 'live\volmanaged_paper.py') {
        $file = Join-Path $Folder $relative
        New-Item -ItemType Directory -Force -Path (Split-Path $file -Parent) | Out-Null
        [System.IO.File]::WriteAllText($file, "stand-in for $relative`n", $Utf8)
    }
}

function Get-FreeDriveLetter {
    foreach ($letter in 'YXWVUTSRQPONM'.ToCharArray()) { if (-not (Test-Path -LiteralPath "${letter}:\")) { return [string]$letter } }
    throw 'no free drive letter for a SUBST drive'
}

function Clear-ProductKeys {
    # What a refused install must not leave; returns the keys it had to remove (a failure of the run).
    param($Facts)
    $left = @(Get-ProductKeys $Facts | Where-Object { Test-Path -LiteralPath $_ })
    foreach ($key in $left) { Remove-Item -LiteralPath $key -Recurse -Force }
    return ,@($left)
}

function Invoke-Refusal {
    # A silent install into a target the hooks must refuse: exit code $RefusedExitCode, no registry entry, nothing written
    # where the target points ($WrittenCheck returns what was written there, "" when nothing was).
    param([string]$InstallerPath, $Facts, [string]$Name, [string]$Target, [scriptblock]$WrittenCheck, [System.Collections.Generic.List[int]]$Tracked, $AppSeen)
    $start = Get-Date
    try { $proc = Start-HiddenProcess $InstallerPath "/S /NS /D=$Target" } catch { Add-Result "refused: $Name" $false "the installer did not start: $($_.Exception.Message)"; return }
    $done = Wait-Silently $proc 60 $ScratchTemp $Tracked $AppSeen
    $code = if ($done) { $proc.ExitCode } else { -1 }
    $written = "$(& $WrittenCheck)"
    # NSIS answers a /D= folder it does not accept (a network path) by falling back to the default folder, so an installer
    # without the guard installs there instead of refusing. Nothing existed there before this run, so it is ours to remove.
    foreach ($default in (Get-DefaultFolders $Facts)) {
        if (Test-Path -LiteralPath $default) {
            $written = "$written; the default folder $default (the installer fell back to it)".TrimStart('; ')
            Remove-Item -LiteralPath $default -Recurse -Force
        }
    }
    $leftKeys = Clear-ProductKeys $Facts
    $ok = $done -and ($code -eq $RefusedExitCode) -and ($written -eq '') -and ($leftKeys.Count -eq 0)
    Add-Result "refused: $Name" $ok "exit code $code (expected $RefusedExitCode), $([math]::Round(((Get-Date) - $start).TotalSeconds, 1)) s, written: [$written], registry left: [$($leftKeys -join ', ')]"
}

function Get-DefaultFolders {
    # The bundler's per-user default and the folder the hooks move it to (%LOCALAPPDATA%\Programs\<product>).
    param($Facts)
    return @((Join-Path $env:LOCALAPPDATA $Facts.Product), (Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') $Facts.Product))
}

function Invoke-RefusalTests {
    param([string]$InstallerPath, $Facts, [bool]$Elevated, [System.Collections.Generic.List[int]]$Tracked, $AppSeen)
    $taken = @(Get-DefaultFolders $Facts | Where-Object { Test-Path -LiteralPath $_ })
    if ($taken.Count -gt 0) { Add-Result 'refusals: the default install folders are free' $false "$($taken -join ', ') exists, so a fallback to it could not be told from an existing install: not run"; return }
    $root = Join-Path $CustomRoot "$Run-refusals"
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $fakeRoot = Join-Path $root 'fake-root'
    $uncScratch = Join-Path $root 'unc-target'
    $planted = Join-Path $root 'links'
    $link = Join-Path $planted 'link'
    foreach ($dir in $fakeRoot, $uncScratch) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    New-PlantedParent $planted
    $letter = Get-FreeDriveLetter
    & (Join-Path $env:SystemRoot 'System32\subst.exe') "${letter}:" $fakeRoot
    if ($LASTEXITCODE -ne 0) { Add-Result 'refusals: SUBST drive' $false "subst ${letter}: failed"; return }
    try {
        $listing = { @(Get-ChildItem -LiteralPath $fakeRoot -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ', ' }
        foreach ($form in "${letter}:\", "${letter}:", "${letter}:/") {
            Invoke-Refusal $InstallerPath $Facts "drive root $form" $form $listing $Tracked $AppSeen
        }
        $unc = "\\localhost\$($uncScratch.Substring(0, 1))`$($uncScratch.Substring(2))\inner"
        Invoke-Refusal $InstallerPath $Facts 'network (UNC) path' $unc { @(Get-ChildItem -LiteralPath $uncScratch -Force | ForEach-Object { $_.Name }) -join ', ' } $Tracked $AppSeen
        $real = Join-Path $planted 'real'
        New-Item -ItemType Directory -Force -Path $real | Out-Null
        New-Item -ItemType Junction -Path $link -Target $real | Out-Null
        Invoke-Refusal $InstallerPath $Facts 'junction' $link { @(Get-ChildItem -LiteralPath $real -Force | ForEach-Object { $_.Name }) -join ', ' } $Tracked $AppSeen
        if ($Elevated) {
            Add-Result 'refused: Program Files and Windows' $false 'this process is elevated, so a failed guard could write there: not run'
        } else {
            foreach ($system in @($env:ProgramFiles, $env:SystemRoot)) {
                $folder = Join-Path $system 'nqt-dec1-refusal-test'
                $written = { if (Test-Path -LiteralPath $folder) { $folder } else { '' } }.GetNewClosure()
                Invoke-Refusal $InstallerPath $Facts "under $system" $folder $written $Tracked $AppSeen
            }
        }
    } finally {
        & (Join-Path $env:SystemRoot 'System32\subst.exe') "${letter}:" /D | Out-Null
        if ((Test-Path -LiteralPath $link) -and ((Get-Item -LiteralPath $link -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { (Get-Item -LiteralPath $link -Force).Delete() }
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-CustomFolderTest {
    # An install into a folder that is NOT pre-protected and sits under a parent that grants Users Modify and Everyone
    # write: the hooks must end with exactly the user, SYSTEM and Administrators and nothing inherited; the uninstaller
    # must remove only what the installer wrote and leave the lab and a file the user added.
    param([string]$InstallerPath, $Facts, [System.Collections.Generic.List[int]]$Tracked, $AppSeen)
    $parent = Join-Path $CustomRoot "$Run-custom"
    $target = Join-Path $parent 'app dir'
    $lab = Join-Path $CustomRoot "$Run-lab"
    $existing = @(Get-ProductKeys $Facts | Where-Object { Test-Path -LiteralPath $_ })
    $refusals = Get-TargetProblems $target $existing
    Add-Result 'custom folder: target and registry refusals' ($refusals.Count -eq 0) "$target; $($refusals -join '; ')"
    if ($refusals.Count -gt 0) { return $null }
    New-PlantedParent $parent
    New-LabSentinel $lab
    $labBefore = Get-TreeDigest $lab
    $planted = Get-AclReport $parent
    Add-Result 'custom folder: the parent grants Users Modify and Everyone write' (@(Get-BroadWriters $planted.rules).Count -ge 2) "parent rules: $(@($planted.rules | ForEach-Object { "$($_.identity):$($_.rights)" }) -join ' || ')"
    $shortcuts = Get-ShortcutNames $Facts
    $install = Invoke-Install $InstallerPath $target $Tracked $AppSeen
    Add-Result 'custom folder: silent install' $install.ok $install.detail
    $report = [ordered]@{ target = $target; parent_acl = $planted }
    if ($install.ok) {
        Test-InstalledFolder $target $Facts $InstallerPath
        Test-InstallRegistry $Facts $target $true
        Test-NoShortcuts $Facts $shortcuts 'custom folder, after install'
        $report['acl'] = Test-InstallAcl $target $Facts
        $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $problems = Get-PrincipalProblems (Get-AclReport $target) $user
        Add-Result 'custom folder holds exactly the user, SYSTEM and Administrators, nothing inherited' ($problems.Count -eq 0) ($problems -join '; ')
        foreach ($name in "$($Facts.MainBinary).exe", 'WebView2Loader.dll', 'uninstall.exe') {
            $file = Join-Path $target $name
            $fileProblems = @(Get-BroadWriters (Get-AclReport $file).rules)
            Add-Result "custom folder: $name has no broad writer" ($fileProblems.Count -eq 0) "$(@($fileProblems | ForEach-Object { $_.identity }) -join ', ')"
        }
        $note = Join-Path $target 'notes-from-the-user.txt'
        [System.IO.File]::WriteAllText($note, "not written by the installer`n", $Utf8)
        $uninstall = Invoke-Uninstall $target $Tracked $AppSeen
        Add-Result 'custom folder: silent uninstall' $uninstall.ok $uninstall.detail
        $left = @(if (Test-Path -LiteralPath $target) { Get-ChildItem -LiteralPath $target -Force -File | ForEach-Object { $_.Name } })
        Add-Result 'uninstall removes only what the installer wrote' ((($left -join ',') -eq 'notes-from-the-user.txt')) "left: $($left -join ', ')"
        Add-Result 'uninstall leaves the lab untouched' ((Get-TreeDigest $lab) -eq $labBefore) $lab
        Test-InstallRegistry $Facts $target $false
        Test-NoShortcuts $Facts $shortcuts 'custom folder, after uninstall'
        Remove-LeftoverManufacturerKey $Facts
    }
    foreach ($path in $parent, $lab) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force } }
    return $report
}

function Invoke-DefaultFolderTest {
    # An install with no /D=: the hooks move the bundler default under %LOCALAPPDATA%\Programs, the folder ends protected, the
    # uninstaller removes what the installer wrote. Opt-in (-DefaultFolder): it writes about 3 MB under the profile on C:.
    param([string]$InstallerPath, $Facts, [System.Collections.Generic.List[int]]$Tracked, $AppSeen)
    $old, $programs = Get-DefaultFolders $Facts
    $existing = @(Get-ProductKeys $Facts | Where-Object { Test-Path -LiteralPath $_ })
    $taken = @(@($old, $programs) | Where-Object { Test-Path -LiteralPath $_ })
    if ($taken.Count -gt 0 -or $existing.Count -gt 0) { Add-Result 'default folder: nothing installed there yet' $false "$($taken -join ', ') $($existing -join ', ') exists: not run"; return }
    $install = Invoke-Install $InstallerPath $programs $Tracked $AppSeen -NoFolder
    Add-Result 'default folder: silent install with no /D=' $install.ok $install.detail
    $exe = "$($Facts.MainBinary).exe"
    Add-Result 'default folder: installed under %LOCALAPPDATA%\Programs\<product>' (Test-Path -LiteralPath (Join-Path $programs $exe)) $programs
    Add-Result 'default folder: nothing under the bundler default %LOCALAPPDATA%\<product>' (-not (Test-Path -LiteralPath $old)) $old
    if (Test-Path -LiteralPath $programs) {
        $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $problems = Get-PrincipalProblems (Get-AclReport $programs) $user
        Add-Result 'default folder holds exactly the user, SYSTEM and Administrators, nothing inherited' ($problems.Count -eq 0) ($problems -join '; ')
        $uninstall = Invoke-Uninstall $programs $Tracked $AppSeen
        Add-Result 'default folder: silent uninstall' $uninstall.ok $uninstall.detail
        Remove-LeftoverManufacturerKey $Facts
        # The uninstaller keeps its own folder when anything else is in it; here nothing is, so what is left is ours to clear.
        if (Test-Path -LiteralPath $programs) { Remove-Item -LiteralPath $programs -Recurse -Force }
    }
    Clear-ProductKeys $Facts | Out-Null
}

function Invoke-CustomFolderTests {
    param([string]$InstallerPath, $Facts, [bool]$Elevated)
    $tracked = New-Object 'System.Collections.Generic.List[int]'
    $appSeen = New-Object 'System.Collections.Generic.List[string]'
    [NqtWindowWatch]::Start()
    $report = Invoke-CustomFolderTest $InstallerPath $Facts $tracked $appSeen
    if ($DefaultFolder) { Invoke-DefaultFolderTest $InstallerPath $Facts $tracked $appSeen }
    Invoke-RefusalTests $InstallerPath $Facts $Elevated $tracked $appSeen
    $events = [NqtWindowWatch]::Stop()
    Test-WatchResult $events 'custom folder and refusals' $CustomRoot $tracked.ToArray()
    return @{ custom = $report; window_events = $events }
}

# ---- the real install guard and the renamed product (AUD-1) -------------------------------------------------------------

function Get-TextSha256 {
    param([string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return (-join ($sha.ComputeHash($Utf8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') })) } finally { $sha.Dispose() }
}

function Get-RealProduct {
    # The real product's identity (src-tauri\tauri.conf.json) and whether it is installed or has state on this account.
    $conf = Get-Content -Raw -Path (Join-Path $Crate 'tauri.conf.json') -Encoding UTF8 | ConvertFrom-Json
    $stateRoot = if ($RealStateRoot) { $RealStateRoot } else { $env:APPDATA }
    return [pscustomobject]@{
        Product = "$($conf.productName)"; Identifier = "$($conf.identifier)"
        Installed = [bool](Test-Path -LiteralPath "$RealUninstallRoot\$($conf.productName)")
        StateExists = [bool](Test-Path -LiteralPath (Join-Path $stateRoot $conf.identifier)) }
}

function Get-IdentityProblems {
    # The installer under test may share neither the product name (its registry keys, folder and shortcuts) nor the
    # identifier (its %APPDATA% and %LOCALAPPDATA% folders) of the real product while that is installed or has state.
    # The upgrade scenario seeds state under the identifier, so it never runs as the real product. A pure function.
    param($Facts, $Real, [bool]$ForUpgrade)
    $out = @()
    if (-not $Facts.BundleId) { $out += 'the installer script names no BUNDLEID' }
    $clash = ($Facts.Product -ieq $Real.Product) -or ($Facts.BundleId -ieq $Real.Identifier)
    if ($clash -and $ForUpgrade) { $out += "the upgrade scenario seeds state under %APPDATA%\$($Facts.BundleId), so it runs only on a renamed product (not '$($Real.Product)' / $($Real.Identifier))" }
    elseif ($clash -and ($Real.Installed -or $Real.StateExists)) {
        $out += "the installer is '$($Facts.Product)' / $($Facts.BundleId) and the real product '$($Real.Product)' / $($Real.Identifier) is installed or has state on this account: test a renamed-product build (tauri.installtest.conf.json)"
    }
    return ,@($out)
}

function Get-VersionProblems {
    # The old installer's version must be strictly below the new one's, compared as numbers.
    param([string]$From, [string]$To)
    $a = $null; $b = $null
    if (-not [version]::TryParse($From, [ref]$a)) { return ,@("the old version '$From' is not a version") }
    if (-not [version]::TryParse($To, [ref]$b)) { return ,@("the new version '$To' is not a version") }
    if ($a -ge $b) { return ,@("the old version $From is not below the new version ${To}: not an upgrade") }
    return ,@()
}

function Get-PairProblems {
    # Both installers of an upgrade must be the same product (name, identifier, manufacturer, binary), old below new.
    param($From, $To)
    $out = @()
    foreach ($field in 'Product', 'BundleId', 'Manufacturer', 'MainBinary') {
        if ("$($From.$field)" -ne "$($To.$field)") { $out += "the two installers differ in $field ('$($From.$field)' and '$($To.$field)')" }
    }
    $out += Get-VersionProblems $From.Version $To.Version
    return ,@($out)
}

function Get-RegistryText {
    # Every value (name, kind, data) and subkey name of a key, sorted; '<absent>' when the key does not exist.
    param([string]$Key)
    if (-not (Test-Path -LiteralPath $Key)) { return '<absent>' }
    $item = Get-Item -LiteralPath $Key
    $lines = @(foreach ($name in @($item.GetValueNames() | Sort-Object)) {
        $value = $item.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        "value|$name|$($item.GetValueKind($name))|$(@($value) -join ',')"
    })
    $lines += @($item.GetSubKeyNames() | Sort-Object | ForEach-Object { "subkey|$_" })
    return ($lines -join "`n")
}

function Get-FolderListing {
    # Every file and folder under $Folder with size, write time and sha256, and the folder's SDDL ('<absent>' if missing).
    # Read only: it opens each file for reading and nothing else.
    param([string]$Folder)
    if (-not $Folder -or -not (Test-Path -LiteralPath $Folder)) { return @('<absent>') }
    $prefix = $Folder.TrimEnd('\') + '\'
    $lines = @(Get-ChildItem -LiteralPath $Folder -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($prefix.Length)
        if ($_.PSIsContainer) { "dir|$relative" } else {
            $hash = try { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } catch { 'unreadable' }
            "file|$relative|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)|$hash"
        } })
    $lines += "sddl|$((Get-Acl -LiteralPath $Folder).Sddl)"
    return $lines
}

function Get-RealInstallSnapshot {
    # The real product's uninstall key, manufacturer key, install folder and state folder, hashed. A function of its
    # roots only, so the self-test runs it on a fake registry root and fake folders.
    param([string]$UninstallRoot, [string]$ManufacturerRoot, [string]$Product, [string]$StateFolder, [string]$DefaultFolder)
    $uninstallKey = "$UninstallRoot\$Product"
    $manufacturerKey = "$ManufacturerRoot\$Product"
    $location = $DefaultFolder
    if (Test-Path -LiteralPath $uninstallKey) {
        $value = (Get-Item -LiteralPath $uninstallKey).GetValue('InstallLocation', $null)
        if ($value) { $location = "$value".Trim('"') }
    }
    $folder = Get-FolderListing $location
    return [ordered]@{
        taken_utc = (Get-Date).ToUniversalTime().ToString('o')
        uninstall_key = $uninstallKey; uninstall_sha256 = (Get-TextSha256 (Get-RegistryText $uninstallKey))
        manufacturer_key = $manufacturerKey; manufacturer_sha256 = (Get-TextSha256 (Get-RegistryText $manufacturerKey))
        install_folder = $location; install_folder_sha256 = (Get-TextSha256 ($folder -join "`n")); install_folder_listing = $folder
        state_folder = $StateFolder; state_sha256 = (Get-TextSha256 ((Get-FolderListing $StateFolder) -join "`n"))
    }
}

function Compare-RealInstallSnapshot {
    # Problems: the uninstall key, the manufacturer key or the install folder changed. Notes: the state folder changed
    # (the owner's running app may write its settings, so that alone does not fail a run).
    param($Before, $After)
    $problems = @(); $notes = @()
    if ($Before.uninstall_sha256 -ne $After.uninstall_sha256) { $problems += "the uninstall key $($Before.uninstall_key) changed" }
    if ($Before.manufacturer_sha256 -ne $After.manufacturer_sha256) { $problems += "the key $($Before.manufacturer_key) changed" }
    if ($Before.install_folder -ne $After.install_folder) { $problems += "the install folder moved from $($Before.install_folder) to $($After.install_folder)" }
    elseif ($Before.install_folder_sha256 -ne $After.install_folder_sha256) {
        $diff = @(Compare-Object @($Before.install_folder_listing) @($After.install_folder_listing) | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" })
        $problems += "the install folder $($Before.install_folder) changed: $($diff -join ' || ')"
    }
    if ($Before.state_sha256 -ne $After.state_sha256) { $notes += "the real state folder $($Before.state_folder) changed during the run (not a failure: the owner's app may write it)" }
    return @{ problems = $problems; notes = $notes }
}

function Get-RealGuardSnapshot {
    $real = Get-RealProduct
    $stateRoot = if ($RealStateRoot) { $RealStateRoot } else { $env:APPDATA }
    $programs = if ($RealProgramsRoot) { $RealProgramsRoot } else { Join-Path $env:LOCALAPPDATA 'Programs' }
    return Get-RealInstallSnapshot $RealUninstallRoot $RealManufacturerRoot $real.Product (Join-Path $stateRoot $real.Identifier) (Join-Path $programs $real.Product)
}

function Test-RealGuard {
    # The after half of the guard: one step that fails on any change of the real install.
    param($Before)
    $after = Get-RealGuardSnapshot
    $cmp = Compare-RealInstallSnapshot $Before $after
    $short = { param($s) if ($s) { $s.Substring(0, 12) } else { '' } }
    Add-Result 'the real install is untouched (uninstall key, manufacturer key, install folder)' ($cmp.problems.Count -eq 0) ("key {0} / {1}, folder {2} ({3} / {4} entries): {5}" -f (& $short $Before.uninstall_sha256), (& $short $after.uninstall_sha256), $Before.install_folder, @($Before.install_folder_listing).Count, @($after.install_folder_listing).Count, ($cmp.problems -join '; '))
    foreach ($note in $cmp.notes) { Write-Host "NOTE  $note" }
    return [ordered]@{ unchanged = ($cmp.problems.Count -eq 0); problems = $cmp.problems; notes = $cmp.notes; before = $Before; after = $after }
}

# ---- the upgrade scenario (REL-05) --------------------------------------------------------------------------------------------

function Get-InstallerFacts {
    # The installer script facts of one installer (with its step), or $null.
    param([string]$InstallerPath, [string]$Label)
    $scriptPath = Find-InstallerScript $InstallerPath
    if (-not $scriptPath) { Add-Result "$Label installer script" $false "no nsis\<build>\installer.nsi beside $InstallerPath for this product"; return $null }
    $facts = Read-InstallerScript (Get-Content -Raw -Path $scriptPath -Encoding UTF8)
    $problems = Get-ScriptProblems $facts
    Add-Result "$Label installer script flags" ($problems.Count -eq 0) "$scriptPath; product '$($facts.Product)' $($facts.Version), identifier $($facts.BundleId); $($problems -join '; ')"
    if ($problems.Count -gt 0) { return $null }
    return $facts
}

function Get-VariantStateFolders {
    param($Facts)
    return @((Join-Path $env:APPDATA $Facts.BundleId), (Join-Path $env:LOCALAPPDATA $Facts.BundleId))
}

function New-UpgradeState {
    # What an upgrade must keep: the variant's settings.json and its backup, a webview stand-in, and a lab with the
    # terminal state the app writes (workspaces, jobs.json) beside the paths of the real lab.
    param($Facts, [string]$Lab)
    $config, $local = Get-VariantStateFolders $Facts
    New-LabSentinel $Lab
    foreach ($relative in 'terminal\state\workspaces\upgrade-test.json', 'terminal\state\jobs.json') {
        $file = Join-Path $Lab $relative
        New-Item -ItemType Directory -Force -Path (Split-Path $file -Parent) | Out-Null
        [System.IO.File]::WriteAllText($file, "{`"stand_in`": `"$($relative.Replace('\', '/'))`"}`n", $Utf8)
    }
    $settings = [ordered]@{ lab = $Lab; webview_data_dir = (Join-Path $local 'EBWebView'); zoom = 100; ib_snapshot = $false } | ConvertTo-Json
    New-Item -ItemType Directory -Force -Path $config, (Join-Path $local 'EBWebView') | Out-Null
    foreach ($name in 'settings.json', 'settings.json.1') { [System.IO.File]::WriteAllText((Join-Path $config $name), $settings + "`n", $Utf8) }
    [System.IO.File]::WriteAllText((Join-Path $local 'EBWebView\stand-in.txt'), "webview data stand-in`n", $Utf8)
    return [ordered]@{ config = $config; local = $local; lab = $Lab }
}

function Get-UpgradeStateDigest {
    param($State)
    return (@($State.config, $State.local, $State.lab) | ForEach-Object { if (Test-Path -LiteralPath $_) { "$_`n" + (Get-TreeDigest $_) } else { "$_ <absent>" } }) -join "`n"
}

function Remove-UpgradeState {
    # Removes only what New-UpgradeState made (the run refused to start when any of it existed), never the real state.
    param($Facts, $State)
    if ($Facts.BundleId -ieq (Get-RealProduct).Identifier) { throw "refusing to remove state of the real identifier $($Facts.BundleId)" }
    foreach ($path in $State.config, $State.local, $State.lab) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force } }
}

function Get-InstalledFiles {
    param([string]$Target)
    if (-not (Test-Path -LiteralPath $Target)) { return ,@() }
    return ,@(Get-ChildItem -LiteralPath $Target -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($Target.TrimEnd('\').Length).TrimStart('\') } | Sort-Object)
}

function Get-PayloadMatch {
    # Whether an installed exe is the payload exe of the build beside $InstallerPath (the bundler stamps at most
    # $BundleMarkerBytes bytes into the installed copy). A missing payload folder is a failure here.
    param([string]$Exe, [string]$InstallerPath, $Facts)
    if (-not (Test-Path -LiteralPath $Exe)) { return @{ ok = $false; note = "no $Exe" } }
    $payload = @(Get-ChildItem (Split-Path $InstallerPath -Parent) -Recurse -Filter "$($Facts.MainBinary).exe" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\payload\\' })
    $same = @($payload | Where-Object { $d = [NqtWindowWatch]::CountDifferences($Exe, $_.FullName); ($d -ge 0) -and ($d -le $BundleMarkerBytes) })
    $note = if ($payload.Count -eq 0) { 'no payload folder beside the installer' } else { "same as the payload exe of: $(@($same | ForEach-Object { Split-Path (Split-Path $_.FullName -Parent) -Leaf }) -join ', ')" }
    return @{ ok = ($same.Count -gt 0); note = $note }
}

function Get-InstalledEntry {
    # DisplayVersion and InstallLocation of the product's HKCU uninstall entry ('' when absent).
    param($Facts)
    $entry = Get-ItemProperty -LiteralPath (Get-ProductKeys $Facts)[0] -ErrorAction SilentlyContinue
    if ($null -eq $entry) { return @{ version = ''; location = ''; present = $false } }
    $version = if ($entry.PSObject.Properties['DisplayVersion']) { "$($entry.DisplayVersion)" } else { '' }
    $location = if ($entry.PSObject.Properties['InstallLocation']) { "$($entry.InstallLocation)".Trim('"') } else { '' }
    return @{ version = $version; location = $location; present = $true }
}

function Test-InstalledVersion {
    # One install as one version: exit 0, DisplayVersion, InstallLocation, the exe of that build and its product version,
    # the file list (nothing left over), exactly three principals and no broad writer, no shortcut, the app not started,
    # no HKLM entry and the stand-in state as seeded.
    param([string]$Label, $Result, $Facts, [string]$InstallerPath, [string]$Target, $Files, $Ctx)
    Add-Result "${Label}: exit code 0" $Result.ok $Result.detail
    $entry = Get-InstalledEntry $Facts
    Add-Result "${Label}: DisplayVersion $($Facts.Version)" ($entry.version -eq $Facts.Version) "DisplayVersion '$($entry.version)'"
    Add-Result "${Label}: InstallLocation is the run folder" ($entry.location -ieq $Target) "InstallLocation '$($entry.location)'"
    $exe = Join-Path $Target "$($Facts.MainBinary).exe"
    $match = Get-PayloadMatch $exe $InstallerPath $Facts
    Add-Result "${Label}: the installed exe is the payload exe of that build" $match.ok $match.note
    $exeVersion = if (Test-Path -LiteralPath $exe) { "$([System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion)" } else { '' }
    Add-Result "${Label}: the exe's product version is $($Facts.Version)" ($exeVersion -like "$($Facts.Version)*") "ProductVersion '$exeVersion'"
    $now = Get-InstalledFiles $Target
    if ($null -ne $Files) { Add-Result "${Label}: the same files as the old install, nothing left over" (($now -join ',') -eq (@($Files) -join ',')) "files: $($now -join ', ')" }
    if (Test-Path -LiteralPath $Target) {
        $principal = Get-PrincipalProblems (Get-AclReport $Target) ([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
        Add-Result "${Label}: the folder holds exactly the user, SYSTEM and Administrators, nothing inherited" ($principal.Count -eq 0) ($principal -join '; ')
        Test-InstallAcl $Target $Facts | Out-Null
    }
    Add-Result "${Label}: no HKLM uninstall entry" (-not (Test-Path -LiteralPath (Get-ProductKeys $Facts)[1])) ''
    Test-NoShortcuts $Facts $Ctx.shortcuts $Label
    Add-Result "${Label}: app not started" (@($Ctx.appSeen).Count -eq 0 -and @(Get-ProcessesFrom $Target).Count -eq 0) "seen: $($Ctx.appSeen -join ', ')"
    Add-Result "${Label}: the stand-in state is unchanged" ((Get-UpgradeStateDigest $Ctx.state) -eq $Ctx.digest) "$($Ctx.state.config), $($Ctx.state.local), $($Ctx.state.lab)"
}

function Install-OldVersion {
    # A fresh install of the old version into the run folder; returns its file list, or $null when it failed.
    param([string]$Label, $Ctx)
    $left = Get-InstalledFiles $Ctx.target
    if ($left.Count -gt 0) { Add-Result "${Label}: the run folder is empty before the old install" $false "left: $($left -join ', ')"; return $null }
    Protect-InstallFolder $Ctx.target
    $r = Invoke-Install $Ctx.from_path $Ctx.target $Ctx.tracked $Ctx.appSeen
    Test-InstalledVersion "$Label, install $($Ctx.from.Version)" $r $Ctx.from $Ctx.from_path $Ctx.target $null $Ctx
    if (-not $r.ok) { return $null }
    return ,(Get-InstalledFiles $Ctx.target)
}

function Test-PlantedRefusal {
    # A file of the user's in the install folder: the new installer must refuse (exit 3) and leave the old version.
    param([string]$Label, $Ctx)
    $exe = Join-Path $Ctx.target "$($Ctx.from.MainBinary).exe"
    $before = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    $note = Join-Path $Ctx.target 'notes-from-the-user.txt'
    [System.IO.File]::WriteAllText($note, "not written by the installer`n", $Utf8)
    try {
        $r = Invoke-Install $Ctx.to_path $Ctx.target $Ctx.tracked $Ctx.appSeen
        $entry = Get-InstalledEntry $Ctx.from
        $after = if (Test-Path -LiteralPath $exe) { (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash } else { '' }
        $ok = ($r.code -eq $RefusedExitCode) -and ($entry.version -eq $Ctx.from.Version) -and ($after -eq $before)
        Add-Result "${Label}: a file of the user in the folder makes the new installer refuse, the old version stays" $ok "$($r.detail) (expected $RefusedExitCode); DisplayVersion '$($entry.version)'; exe unchanged: $($after -eq $before)"
    } finally {
        Remove-Item -LiteralPath $note -Force -ErrorAction SilentlyContinue
    }
}

function Test-UpgradeUninstall {
    # The silent uninstall after a path: no file left, the entry gone, the data kept.
    param([string]$Label, $Facts, $Ctx)
    $u = Invoke-Uninstall $Ctx.target $Ctx.tracked $Ctx.appSeen
    Add-Result "${Label}: silent uninstall" $u.ok $u.detail
    $left = Get-InstalledFiles $Ctx.target
    Add-Result "${Label}: uninstall leaves no files" ($left.Count -eq 0) "left: $($left -join ', ')"
    if ((Test-Path -LiteralPath $Ctx.target) -and $left.Count -eq 0) { Remove-Item -LiteralPath $Ctx.target -Recurse -Force }
    Add-Result "${Label}: the uninstall entry is gone" (-not (Get-InstalledEntry $Facts).present) ''
    Add-Result "${Label}: uninstall keeps the data (settings, webview stand-in, lab)" ((Get-UpgradeStateDigest $Ctx.state) -eq $Ctx.digest) ''
    Test-NoShortcuts $Facts $Ctx.shortcuts "$Label, after uninstall"
}

function Invoke-UpgradePath {
    # One path from a fresh old install: a (plain /D=, after the planted-file refusal), b (/UPDATE), c (no /D=, then the
    # downgrade over the top). Returns $false when the old install itself failed.
    param([string]$Path, $Ctx)
    $label = "upgrade $Path"
    $files = Install-OldVersion $label $Ctx
    if ($null -eq $files) { return $false }
    if ($Path -eq 'a') { Test-PlantedRefusal $label $Ctx }
    $r = switch ($Path) {
        'b' { Invoke-Install $Ctx.to_path $Ctx.target $Ctx.tracked $Ctx.appSeen -Extra '/UPDATE' }
        'c' { Invoke-Install $Ctx.to_path $Ctx.target $Ctx.tracked $Ctx.appSeen -NoFolder }
        default { Invoke-Install $Ctx.to_path $Ctx.target $Ctx.tracked $Ctx.appSeen }
    }
    Test-InstalledVersion "$label, $($Ctx.from.Version) to $($Ctx.to.Version)" $r $Ctx.to $Ctx.to_path $Ctx.target $files $Ctx
    $last = $Ctx.to
    if ($Path -eq 'c') {
        $strays = @(Get-DefaultFolders $Ctx.to | Where-Object { Test-Path -LiteralPath $_ })
        Add-Result "${label}: the remembered folder was used, nothing in the default folders" ($strays.Count -eq 0) "found: $($strays -join ', ')"
        $down = Invoke-Install $Ctx.from_path $Ctx.target $Ctx.tracked $Ctx.appSeen
        Test-InstalledVersion "downgrade over the top, $($Ctx.to.Version) back to $($Ctx.from.Version)" $down $Ctx.from $Ctx.from_path $Ctx.target $files $Ctx
        $last = $Ctx.from
    }
    Test-UpgradeUninstall "$label, uninstall" $last $Ctx
    return $true
}

function Clear-UpgradeLeftovers {
    # After the scenario, whatever a failed step left of THIS variant: its install, its default folders (absent before
    # the run), the run folder when empty, its registry keys. Never anything of another product.
    param($Facts, [string]$Target, $Tracked, $AppSeen)
    $entry = Get-InstalledEntry $Facts
    if ($entry.present -and $entry.location -and (Test-Path -LiteralPath (Join-Path $entry.location 'uninstall.exe'))) {
        Invoke-Uninstall $entry.location $Tracked $AppSeen | Out-Null
        Write-Host "NOTE  cleared a leftover install of $($Facts.Product) at $($entry.location)"
    }
    foreach ($default in (Get-DefaultFolders $Facts)) { if (Test-Path -LiteralPath $default) { Remove-Item -LiteralPath $default -Recurse -Force; Write-Host "NOTE  removed $default" } }
    if ((Test-Path -LiteralPath $Target) -and (Get-InstalledFiles $Target).Count -eq 0) { Remove-Item -LiteralPath $Target -Recurse -Force }
    Remove-LeftoverManufacturerKey $Facts
    $left = Clear-ProductKeys $Facts
    if ($left.Count -gt 0) { Write-Host "NOTE  removed leftover keys: $($left -join ', ')" }
}

function Invoke-UpgradeTest {
    param([string]$FromPath, [string]$ToPath)
    $from = Get-InstallerFacts $FromPath 'old'
    $to = Get-InstallerFacts $ToPath 'new'
    if ($null -eq $from -or $null -eq $to) { return }
    $script:Tested = @{ to = $to; to_path = $ToPath; from = $from; from_path = $FromPath }
    $target = Join-Path $InstallRoot "$Run-upgrade"
    $refusals = @()
    $refusals += Get-IdentityProblems $to (Get-RealProduct) $true
    $refusals += Get-PairProblems $from $to
    $refusals += Get-TargetProblems $target @(Get-ProductKeys $to | Where-Object { Test-Path -LiteralPath $_ })
    $refusals += @(Get-DefaultFolders $to | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { "the default folder $_ exists (an install of this variant)" })
    $refusals += @(Get-VariantStateFolders $to | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { "the variant's state folder $_ exists already (not this run's to seed and remove)" })
    Add-Result 'upgrade refusals (renamed product, one product, old below new, empty target, no install or state yet)' ($refusals.Count -eq 0) "$target; $($refusals -join '; ')"
    if ($refusals.Count -gt 0) { return }
    $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Add-Result 'this process is not elevated' (-not $elevated) "elevated: $elevated (a per-user install needs none)"
    $ctx = @{ from = $from; from_path = $FromPath; to = $to; to_path = $ToPath; target = $target; shortcuts = (Get-ShortcutNames $to)
        tracked = (New-Object 'System.Collections.Generic.List[int]'); appSeen = (New-Object 'System.Collections.Generic.List[string]'); state = $null; digest = '' }
    $report = [ordered]@{ from = $FromPath; to = $ToPath; from_version = $from.Version; to_version = $to.Version; target = $target }
    [NqtWindowWatch]::Start()
    try {
        $ctx.state = New-UpgradeState $to (Join-Path $CustomRoot "$Run-upgrade-lab")
        $ctx.digest = Get-UpgradeStateDigest $ctx.state
        $report['state'] = $ctx.state
        foreach ($path in 'a', 'b', 'c') { if (-not (Invoke-UpgradePath $path $ctx)) { break } }
    } finally {
        $events = [NqtWindowWatch]::Stop()
        Test-WatchResult $events 'upgrade, downgrade and uninstall' $target $ctx.tracked.ToArray()
        $report['window_events'] = $events
        Clear-UpgradeLeftovers $to $target $ctx.tracked $ctx.appSeen
        if ($null -ne $ctx.state) { Remove-UpgradeState $to $ctx.state }
    }
    $script:Report = $report
}

# ---- building the renamed-product installer of a git ref ---------------------------------------------------------------------

function Invoke-Git {
    # git in the terminal repository; returns the exit code and the output lines.
    param([string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $out = @(& git -C $Terminal @Arguments 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    return @{ code = $code; out = $out }
}

function Get-ReparsePoints {
    # Junctions and links inside a folder (a worktree that holds one is never removed with --force).
    param([string]$Folder)
    return ,@(Get-ChildItem -LiteralPath $Folder -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
}

function Remove-BuildWorktree {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 'removed (absent)' }
    $plain = Invoke-Git @('worktree', 'remove', $Path)
    if ($plain.code -eq 0) { return 'removed' }
    $item = Get-Item -LiteralPath $Path -Force
    $points = Get-ReparsePoints $Path
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $points.Count -gt 0) { return "NOT removed: $Path is or holds a reparse point ($($points -join ', ')); remove it by hand" }
    $forced = Invoke-Git @('worktree', 'remove', '--force', $Path)
    if ($forced.code -eq 0) { return "removed with --force (no reparse point inside) after: $($plain.out -join ' ')" }
    return "NOT removed: $($forced.out -join ' ')"
}

function Set-BuildEnvironment {
    # The Rust toolchain on D: for this process only; returns what it replaced so it can be put back.
    $saved = @{}
    foreach ($name in 'RUSTUP_HOME', 'CARGO_HOME', 'CARGO_TARGET_DIR', 'PATH', 'CARGO_BUILD_JOBS') { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    $env:RUSTUP_HOME = 'D:\dev\rustup'
    $env:CARGO_HOME = 'D:\dev\cargo'
    $env:CARGO_TARGET_DIR = $TargetDir
    $env:PATH = "D:\dev\cargo\bin;D:\dev\mingw\mingw64\bin;$env:PATH"
    if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '8' }
    return $saved
}

function Restore-Environment {
    param($Saved)
    foreach ($name in $Saved.Keys) { [Environment]::SetEnvironmentVariable($name, $Saved[$name], 'Process') }
}

function Get-OverlayText {
    # The renamed-product overlay of this tree, with the version override when one is given.
    param([string]$Version)
    $overlay = Get-Content -Raw -Path $OverlayFile -Encoding UTF8 | ConvertFrom-Json
    $doc = [ordered]@{ productName = "$($overlay.productName)"; identifier = "$($overlay.identifier)" }
    if ($Version) { $doc['version'] = $Version }
    return (($doc | ConvertTo-Json) + "`n")
}

function Test-ReusableBuild {
    # An existing build folder whose BUILD.json names the same commit, version and overlay, with its installer intact.
    param([string]$Out, [string]$Commit, [string]$Version, [string]$OverlaySha)
    $file = Join-Path $Out 'BUILD.json'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    try { $old = Get-Content -Raw -Path $file -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
    $installer = Join-Path $Out "$($old.installer)"
    if ($old.commit -ne $Commit -or $old.version -ne $Version -or $old.overlay_sha256 -ne $OverlaySha -or -not (Test-Path -LiteralPath $installer)) { return $null }
    if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $old.sha256) { return $null }
    return $installer
}

function Copy-RenamedBuild {
    # The build's outputs into $Out, laid out like a release folder; returns the installer path or $null.
    param([string]$Worktree, [string]$Out, $Overlay, [string]$Version, [datetime]$Start)
    $release = Join-Path $TargetDir 'release'
    $name = "$($Overlay.productName)_${Version}_x64-setup.exe"
    $built = Join-Path $release "bundle\nsis\$name"
    $fresh = (Test-Path -LiteralPath $built) -and ((Get-Item -LiteralPath $built).LastWriteTime -ge $Start)
    Add-Result 'build: a fresh installer of the renamed product' $fresh $built
    if (-not $fresh) { return $null }
    if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Recurse -Force }
    foreach ($dir in 'nsis\installtest', 'payload\installtest') { New-Item -ItemType Directory -Force -Path (Join-Path $Out $dir) | Out-Null }
    Copy-Item -LiteralPath $built -Destination $Out
    Copy-Item -LiteralPath (Join-Path $release 'nsis\x64\installer.nsi') -Destination (Join-Path $Out 'nsis\installtest')
    Copy-Item -LiteralPath (Join-Path $Worktree 'desktop\src-tauri\windows\nsis\hooks.nsh') -Destination (Join-Path $Out 'nsis\installtest')
    foreach ($file in 'nq-lab-terminal.exe', 'WebView2Loader.dll') { Copy-Item -LiteralPath (Join-Path $release $file) -Destination (Join-Path $Out 'payload\installtest') }
    $facts = Read-InstallerScript (Get-Content -Raw -Path (Join-Path $Out 'nsis\installtest\installer.nsi') -Encoding UTF8)
    $named = ($facts.Product -eq $Overlay.productName) -and ($facts.BundleId -eq $Overlay.identifier) -and ($facts.Version -eq $Version)
    Add-Result 'build: the installer script is the renamed product at that version' $named "product '$($facts.Product)', identifier $($facts.BundleId), version $($facts.Version)"
    $exeVersion = "$([System.Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $Out 'payload\installtest\nq-lab-terminal.exe')).ProductVersion)"
    Add-Result 'build: the payload exe carries that version' ($exeVersion -like "$Version*") "ProductVersion '$exeVersion'"
    if (-not $named) { return $null }
    return (Join-Path $Out $name)
}

function Invoke-RenamedBuild {
    # The renamed-product installer of a git ref, built in a temporary detached worktree (never in this tree).
    param([string]$Ref, [string]$Version)
    if (-not $TargetDir.StartsWith('D:\dev\targets\', [System.StringComparison]::OrdinalIgnoreCase)) { Add-Result 'build: target folder under D:\dev\targets' $false $TargetDir; return $null }
    $commit = Invoke-Git @('rev-parse', '--verify', '--quiet', "$Ref^{commit}")
    if ($commit.code -ne 0 -or $commit.out.Count -eq 0) { Add-Result 'build: the ref names a commit' $false "'$Ref' is not a commit of $Terminal"; return $null }
    $sha = $commit.out[0].Trim()
    $short = $sha.Substring(0, 10)
    $refConf = (Invoke-Git @('show', "${sha}:desktop/src-tauri/tauri.conf.json")).out -join "`n" | ConvertFrom-Json
    $version = if ($Version) { $Version } else { "$($refConf.version)" }
    $versionProblems = Get-VersionProblems "$($refConf.version)" $Version
    if ($Version -and ($Version -ne "$($refConf.version)") -and $versionProblems.Count -gt 0) { Add-Result 'build: -BuildVersion is not below the version of the ref' $false "ref $($refConf.version), asked $Version"; return $null }
    $overlayText = Get-OverlayText $(if ($Version) { $Version } else { '' })
    $overlay = $overlayText | ConvertFrom-Json
    $overlaySha = Get-TextSha256 $overlayText
    $out = Join-Path $BuildOut "$version-$short"
    $reuse = Test-ReusableBuild $out $sha $version $overlaySha
    if ($reuse) { Add-Result 'build: an existing renamed build of this commit, version and overlay is reused' $true $reuse; return $reuse }
    $worktree = Join-Path $WorktreeRoot "nqt-installtest-$short-$PID"
    if (Test-Path -LiteralPath $worktree) { Add-Result 'build: the worktree folder is free' $false $worktree; return $null }
    $logDir = Join-Path $BuildOut 'logs'
    New-Item -ItemType Directory -Force -Path $logDir, $ScratchTemp | Out-Null
    $log = Join-Path $logDir ("$version-$short-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $overlayPath = Join-Path $ScratchTemp "installtest-overlay-$short-$PID.json"
    [System.IO.File]::WriteAllText($overlayPath, $overlayText, $Utf8)
    $add = Invoke-Git @('worktree', 'add', '--detach', $worktree, $sha)
    Add-Result "build: a temporary detached worktree of $Ref ($short)" ($add.code -eq 0) "$worktree $(@($add.out | Where-Object { $_ -notmatch 'Updating files' }) -join ' ')"
    if ($add.code -ne 0) { return $null }
    $saved = Set-BuildEnvironment
    try {
        $start = Get-Date
        Push-Location (Join-Path $worktree 'desktop')
        try {
            $ErrorActionPreference = 'Continue'
            & cargo tauri build --bundles nsis --config $overlayPath -- --locked *> $log
            $code = $LASTEXITCODE
            $ErrorActionPreference = 'Stop'
        } finally { Pop-Location }
        $seconds = [math]::Round(((Get-Date) - $start).TotalSeconds)
        Add-Result "build: cargo tauri build of $Ref as $($overlay.productName) $version" ($code -eq 0) "exit $code in $seconds s, log $log"
        if ($code -ne 0) { return $null }
        $installer = Copy-RenamedBuild $worktree $out $overlay $version $start
        if ($null -eq $installer) { return $null }
        $item = Get-Item -LiteralPath $installer
        $doc = [ordered]@{ ref = $Ref; commit = $sha; version = $version; ref_version = "$($refConf.version)"; product = $overlay.productName; identifier = $overlay.identifier
            installer = $item.Name; size = $item.Length; sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
            overlay_sha256 = $overlaySha; overlay = $overlay; target_dir = $TargetDir; built_utc = (Get-Date).ToUniversalTime().ToString('o'); log = $log }
        [System.IO.File]::WriteAllText((Join-Path $out 'BUILD.json'), (($doc | ConvertTo-Json -Depth 4) + "`n"), $Utf8)
        return $installer
    } finally {
        Restore-Environment $saved
        $removed = Remove-BuildWorktree $worktree
        Add-Result 'build: the temporary worktree is removed' ($removed -like 'removed*') "$worktree $removed"
        Remove-Item -LiteralPath $overlayPath -Force -ErrorAction SilentlyContinue
    }
}

# ---- the stamped record (REL-06) ---------------------------------------------------------------------------------------------

function Get-TreeStamp {
    # The provenance stamp of this tree (record_green.ps1 -Stamp), or $null.
    $ErrorActionPreference = 'Continue'
    $text = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Terminal 'scripts\record_green.ps1') -Stamp 2>$null
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -ne 0) { return $null }
    try { return (($text -join "`n") | ConvertFrom-Json) } catch { return $null }
}

function Get-InstallerRecord {
    param([string]$Path, $Facts)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $null }
    $item = Get-Item -LiteralPath $Path
    $known = $null -ne $Facts
    return [ordered]@{ name = $item.Name; path = $item.FullName; size = $item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        product = $(if ($known) { $Facts.Product } else { '' }); identifier = $(if ($known) { $Facts.BundleId } else { '' }); version = $(if ($known) { $Facts.Version } else { '' }) }
}

function New-InstallRecord {
    # The stamped record of one run, a pure function of its inputs: exit code 0 only when there were steps, every one
    # passed, the installer is known and the real install guard saw no change.
    param([string]$Scenario, $Steps, $To, $From, $Guard, $Stamp, [string]$ReportFile, [string]$Date, [string]$Computer, [bool]$Foreign, [string]$RealProductName)
    # foreach, not @($Steps): Windows PowerShell 5.1 throws "Argument types do not match" on @() of a List[object].
    $all = @(foreach ($step in $Steps) { $step })
    $failed = @($all | Where-Object { -not $_.passed })
    $guardOk = ($null -ne $Guard) -and [bool]$Guard['unchanged']
    $ok = ($all.Count -gt 0) -and ($failed.Count -eq 0) -and ($null -ne $To) -and $guardOk
    $variant = if ($null -ne $To -and $To['product'] -and $To['product'] -ne $RealProductName) { 'renamed' } else { 'release' }
    return [ordered]@{
        check = $Scenario; date = $Date; pc = $Computer; finished_utc = (Get-Date).ToUniversalTime().ToString('o'); self_test = $false
        exit_code = $(if ($ok) { 0 } else { 1 })
        steps_total = $all.Count; steps_passed = ($all.Count - $failed.Count); steps_failed = $failed.Count
        failed_steps = @($failed | ForEach-Object { $_.step })
        version = $(if ($null -ne $To) { $To['version'] } else { '' }); variant = $variant
        installer = $To; from_installer = $From; allow_foreign = $Foreign
        real_install = [ordered]@{ unchanged = $guardOk; problems = $(if ($null -ne $Guard) { @($Guard['problems']) } else { @('the guard did not run') }) }
        head = $(if ($null -ne $Stamp) { $Stamp.head } else { '' }); stamp = $Stamp; report = $ReportFile
    }
}

function Write-InstallRecord {
    param($Record)
    $dir = if ($RecordDir) { $RecordDir } else { Join-Path $Terminal 'state\release' }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir ("{0}_{1}.json" -f $Record.date, $Record.check)
    [System.IO.File]::WriteAllText($file, (($Record | ConvertTo-Json -Depth 8) + "`n"), $Utf8)
    return $file
}

# ---- self-test -------------------------------------------------------------------------------------------------------------

function Expect {
    param([string]$Name, [bool]$Condition)
    Add-Result "self-test $Name" $Condition ''
}

function New-AclRule {
    param([string]$Identity, [string]$Sid, [int]$Mask, [string]$Type = 'Allow')
    return [ordered]@{ identity = $Identity; sid = $Sid; rights = "$Mask"; mask = $Mask; type = $Type; inherited = $true }
}

function Test-AclSelfTest {
    # Born-failing checks of the ACL assertion: the rule sets and a real scratch folder, never an install.
    $modify = 197055; $readExec = 131241; $full = 2032127
    $everyone = New-AclRule 'Everyone' 'S-1-1-0' $modify
    $authUsers = New-AclRule 'NT AUTHORITY\Authenticated Users' 'S-1-5-11' $modify
    $localised = New-AclRule 'NT-AUTORITAET\Authentifizierte Benutzer' 'S-1-5-11' $modify
    $users = New-AclRule 'BUILTIN\Users' 'S-1-5-32-545' $full
    $usersRead = New-AclRule 'BUILTIN\Users' 'S-1-5-32-545' $readExec
    $usersDeny = New-AclRule 'BUILTIN\Users' 'S-1-5-32-545' $modify 'Deny'
    $system = New-AclRule 'NT AUTHORITY\SYSTEM' 'S-1-5-18' $full
    $owner = New-AclRule 'PC\owner' 'S-1-5-21-1-2-3-1001' $full
    Expect 'Authenticated Users with Modify is a broad writer (born failing)' (@(Get-BroadWriters @($system, $authUsers)).Count -eq 1)
    Expect 'Everyone with Modify is a broad writer (born failing)' (@(Get-BroadWriters @($everyone)).Count -eq 1)
    Expect 'Users with FullControl is a broad writer (born failing)' (@(Get-BroadWriters @($users)).Count -eq 1)
    Expect 'a broad group is found by its SID when its name is localised (born failing)' (@(Get-BroadWriters @($localised)).Count -eq 1)
    Expect 'read and execute for Users is not a writer' (@(Get-BroadWriters @($usersRead, $system, $owner)).Count -eq 0)
    Expect 'a Deny rule is not a writer' (@(Get-BroadWriters @($usersDeny)).Count -eq 0)
    Expect 'SYSTEM and the owner with FullControl are not broad writers' (@(Get-BroadWriters @($system, $owner)).Count -eq 0)
    $folder = Join-Path $ScratchTemp ('acl-self-test-' + [guid]::NewGuid().ToString('N'))
    try {
        Protect-InstallFolder $folder
        $report = Get-AclReport $folder
        Expect 'a protected folder has inheritance removed and no broad writer' ($report.protected -and @($report.writable_by_broad_groups).Count -eq 0)
        Expect 'a protected folder keeps the current user able to write' (@($report.rules | Where-Object { $_.type -eq 'Allow' -and ($_.mask -band 2) -ne 0 -and $_.identity -eq [Security.Principal.WindowsIdentity]::GetCurrent().Name }).Count -gt 0)
        $dir = Get-Item -LiteralPath $folder
        $acl = $dir.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
        $sid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-11')
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
        $dir.SetAccessControl($acl)
        Expect 'a real folder granted to Authenticated Users is reported (born failing)' (@((Get-AclReport $folder).writable_by_broad_groups).Count -eq 1)
    } finally {
        if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
    }
}

function Test-CustomFolderSelfTest {
    # Born-failing checks of the custom-folder assertions: rule sets, a planted parent on disk, a digest and a SUBST drive;
    # never an install.
    $user = 'S-1-5-21-1-2-3-1001'
    $mask = 2032127
    $good = @((New-AclRule 'PC\owner' $user $mask), (New-AclRule 'NT AUTHORITY\SYSTEM' 'S-1-5-18' $mask), (New-AclRule 'BUILTIN\Administrators' 'S-1-5-32-544' $mask))
    foreach ($rule in $good) { $rule['inherited'] = $false }
    $exact = [ordered]@{ protected = $true; rules = $good }
    Expect 'exactly the user, SYSTEM and Administrators, protected and not inherited, has no problem' ((Get-PrincipalProblems $exact $user).Count -eq 0)
    Expect 'a folder that still inherits is reported (born failing)' ((Get-PrincipalProblems ([ordered]@{ protected = $false; rules = $good }) $user).Count -gt 0)
    $inheritedUsers = @($good) + @((New-AclRule 'BUILTIN\Users' 'S-1-5-32-545' 197055))
    Expect 'an inherited Users Modify rule is reported (born failing)' ((Get-PrincipalProblems ([ordered]@{ protected = $true; rules = $inheritedUsers }) $user).Count -gt 0)
    $explicitEveryone = New-AclRule 'Everyone' 'S-1-1-0' 131072; $explicitEveryone['inherited'] = $false
    Expect 'an explicit extra principal is reported (born failing)' ((Get-PrincipalProblems ([ordered]@{ protected = $true; rules = @($good) + @($explicitEveryone) }) $user).Count -gt 0)
    Expect 'a missing Administrators rule is reported (born failing)' ((Get-PrincipalProblems ([ordered]@{ protected = $true; rules = @($good[0], $good[1]) }) $user).Count -gt 0)
    $deny = New-AclRule 'PC\owner' $user $mask 'Deny'; $deny['inherited'] = $false
    Expect 'a Deny rule is reported (born failing)' ((Get-PrincipalProblems ([ordered]@{ protected = $true; rules = @($good) + @($deny) }) $user).Count -gt 0)
    $root = Join-Path $ScratchTemp ('custom-self-test-' + [guid]::NewGuid().ToString('N'))
    try {
        $parent = Join-Path $root 'parent'
        New-PlantedParent $parent
        $child = Join-Path $parent 'child'
        New-Item -ItemType Directory -Path $child | Out-Null
        $childRules = (Get-AclReport $child).rules
        Expect 'a folder created under the planted parent inherits Users Modify and Everyone write (the plant works)' (@(Get-BroadWriters $childRules | Where-Object { $_.inherited }).Count -ge 2)
        Expect 'that inherited child is reported by the principal check (born failing)' ((Get-PrincipalProblems (Get-AclReport $child) ([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)).Count -gt 0)
        $lab = Join-Path $root 'lab'
        New-LabSentinel $lab
        $before = Get-TreeDigest $lab
        Expect 'the digest of an untouched lab is stable' ($before -eq (Get-TreeDigest $lab))
        [System.IO.File]::AppendAllText((Join-Path $lab 'results\ledger.csv'), 'one more line')
        Expect 'a changed lab file changes the digest (born failing)' ($before -ne (Get-TreeDigest $lab))
        Remove-Item -LiteralPath (Join-Path $lab 'live') -Recurse -Force
        Expect 'a removed lab folder changes the digest (born failing)' ($before -ne (Get-TreeDigest $lab))
        $letter = Get-FreeDriveLetter
        & (Join-Path $env:SystemRoot 'System32\subst.exe') "${letter}:" $root
        try { Expect 'a SUBST drive root exists while mapped' (Test-Path -LiteralPath "${letter}:\") }
        finally { & (Join-Path $env:SystemRoot 'System32\subst.exe') "${letter}:" /D | Out-Null }
        Expect 'a SUBST drive root is gone once removed' (-not (Test-Path -LiteralPath "${letter}:\"))
    } finally {
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    }
    Expect 'the refusal exit code is 3, not a success or a plain failure' ($RefusedExitCode -eq 3)
}

function Test-GuardSelfTest {
    # Born-failing checks of the real install guard on a fake registry root (HKCU\Software\nqt-install-selftest-<id>) and
    # fake folders under D:\dev\tmp; the real keys and folders are never read here.
    $id = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $root = "Registry::HKEY_CURRENT_USER\Software\nqt-install-selftest-$id"
    $uninstallRoot = "$root\Uninstall"
    $manufacturerRoot = "$root\nqlab"
    $product = 'nqt selftest product'
    $folders = Join-Path $ScratchTemp "guard-self-test-$id"
    $app = Join-Path $folders 'Programs\nqt selftest product'
    $state = Join-Path $folders 'Roaming\dev.nqt.selftest'
    $key = "$uninstallRoot\$product"
    $manufacturerKey = "$manufacturerRoot\$product"
    try {
        New-Item -Path $key -Force | Out-Null
        New-ItemProperty -LiteralPath $key -Name 'DisplayVersion' -Value '0.1.1' -PropertyType String | Out-Null
        New-ItemProperty -LiteralPath $key -Name 'InstallLocation' -Value "`"$app`"" -PropertyType String | Out-Null
        New-Item -Path $manufacturerKey -Force | Out-Null
        Set-ItemProperty -LiteralPath $manufacturerKey -Name '(default)' -Value $app
        New-Item -ItemType Directory -Force -Path $app, $state | Out-Null
        foreach ($name in 'nq-lab-terminal.exe', 'uninstall.exe') { [System.IO.File]::WriteAllText((Join-Path $app $name), "bytes of $name", $Utf8) }
        [System.IO.File]::WriteAllText((Join-Path $state 'settings.json'), '{"zoom": 100}', $Utf8)
        $snap = { Get-RealInstallSnapshot $uninstallRoot $manufacturerRoot $product $state (Join-Path $folders 'Programs\default') }
        $a = & $snap
        Expect 'an untouched real install gives the same snapshot twice' ((Compare-RealInstallSnapshot $a (& $snap)).problems.Count -eq 0)
        Expect 'the snapshot lists the folder named by InstallLocation' (($a.install_folder -eq $app) -and @($a.install_folder_listing | Where-Object { $_ -like 'file|nq-lab-terminal.exe|*' }).Count -eq 1)
        Set-ItemProperty -LiteralPath $key -Name 'DisplayVersion' -Value '0.1.2'
        Expect 'a changed value of the real uninstall key is detected (born failing)' ((Compare-RealInstallSnapshot $a (& $snap)).problems.Count -gt 0)
        Set-ItemProperty -LiteralPath $key -Name 'DisplayVersion' -Value '0.1.1'
        Expect 'the value set back gives the first snapshot again' ((Compare-RealInstallSnapshot $a (& $snap)).problems.Count -eq 0)
        New-ItemProperty -LiteralPath $key -Name 'NoModify' -Value 1 -PropertyType DWord | Out-Null
        Expect 'a value added to the real uninstall key is detected (born failing)' ((Compare-RealInstallSnapshot $a (& $snap)).problems.Count -gt 0)
        Remove-ItemProperty -LiteralPath $key -Name 'NoModify'
        Set-ItemProperty -LiteralPath $manufacturerKey -Name '(default)' -Value 'D:\elsewhere'
        Expect 'a changed remembered folder of the real product is detected (born failing)' ((Compare-RealInstallSnapshot $a (& $snap)).problems.Count -gt 0)
        Set-ItemProperty -LiteralPath $manufacturerKey -Name '(default)' -Value $app
        Expect 'the guard is clean again before the folder cases' ((Compare-RealInstallSnapshot $a (& $snap)).problems.Count -eq 0)
        [System.IO.File]::WriteAllText((Join-Path $state 'settings.json'), '{"zoom": 110}', $Utf8)
        $stateChange = Compare-RealInstallSnapshot $a (& $snap)
        Expect 'a changed real state folder is a note, not a failure' (($stateChange.problems.Count -eq 0) -and ($stateChange.notes.Count -eq 1))
        [System.IO.File]::AppendAllText((Join-Path $app 'nq-lab-terminal.exe'), 'x')
        Expect 'a changed file in the real install folder is detected (born failing)' ((Compare-RealInstallSnapshot $a (& $snap)).problems.Count -gt 0)
        $b = & $snap
        [System.IO.File]::WriteAllText((Join-Path $app 'planted.dll'), 'planted', $Utf8)
        Expect 'a file added to the real install folder is detected (born failing)' ((Compare-RealInstallSnapshot $b (& $snap)).problems.Count -gt 0)
        Remove-Item -LiteralPath (Join-Path $app 'planted.dll') -Force
        Remove-Item -LiteralPath $key -Recurse -Force
        Expect 'a removed real uninstall key is detected (born failing)' ((Compare-RealInstallSnapshot $b (& $snap)).problems.Count -gt 0)
    } finally {
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
        if (Test-Path -LiteralPath $folders) { Remove-Item -LiteralPath $folders -Recurse -Force }
    }
    Expect 'the fake registry root is gone' (-not (Test-Path -LiteralPath $root))
}

function New-FakeFacts {
    param([string]$Product, [string]$BundleId, [string]$Version = '0.1.2', [string]$Manufacturer = 'nqlab')
    return [pscustomobject]@{ Product = $Product; BundleId = $BundleId; Version = $Version; Manufacturer = $Manufacturer; MainBinary = 'nq-lab-terminal' }
}

function Test-IdentitySelfTest {
    # Born-failing checks of the renamed-product refusals, the version order, the record and the worktree guard.
    $real = [pscustomobject]@{ Product = 'nq-lab terminal'; Identifier = 'dev.nqlab.terminal'; Installed = $true; StateExists = $true }
    $clean = [pscustomobject]@{ Product = 'nq-lab terminal'; Identifier = 'dev.nqlab.terminal'; Installed = $false; StateExists = $false }
    $realFacts = New-FakeFacts 'nq-lab terminal' 'dev.nqlab.terminal'
    $renamed = New-FakeFacts 'nq-lab terminal installtest' 'dev.nqlab.terminal.installtest'
    $sameId = New-FakeFacts 'nq-lab terminal other' 'dev.nqlab.terminal'
    Expect 'the real product is refused while it is installed (born failing)' ((Get-IdentityProblems $realFacts $real $false).Count -gt 0)
    Expect 'another name with the real identifier is refused (it would share the real state folders) (born failing)' ((Get-IdentityProblems $sameId $real $false).Count -gt 0)
    Expect 'the renamed product is accepted beside the real install' ((Get-IdentityProblems $renamed $real $false).Count -eq 0)
    Expect 'the real product is accepted on an account that has none of it' ((Get-IdentityProblems $realFacts $clean $false).Count -eq 0)
    Expect 'the upgrade scenario refuses the real product even on a clean account (born failing)' ((Get-IdentityProblems $realFacts $clean $true).Count -gt 0)
    Expect 'the upgrade scenario accepts the renamed product' ((Get-IdentityProblems $renamed $real $true).Count -eq 0)
    Expect 'an upgrade from a lower version is accepted' ((Get-VersionProblems '0.1.1' '0.1.2').Count -eq 0)
    Expect 'an upgrade to the same version is refused (born failing)' ((Get-VersionProblems '0.1.1' '0.1.1').Count -gt 0)
    Expect 'an upgrade to a lower version is refused (born failing)' ((Get-VersionProblems '0.1.2' '0.1.1').Count -gt 0)
    Expect 'versions compare as numbers (0.1.9 is below 0.1.10)' ((Get-VersionProblems '0.1.9' '0.1.10').Count -eq 0)
    $old = New-FakeFacts 'nq-lab terminal installtest' 'dev.nqlab.terminal.installtest' '0.1.1'
    Expect 'two builds of one renamed product pair up' ((Get-PairProblems $old $renamed).Count -eq 0)
    Expect 'an upgrade between two products is refused (born failing)' ((Get-PairProblems $old (New-FakeFacts 'nq-lab terminal measure' 'dev.nqlab.terminal.measure')).Count -gt 0)
    $steps = @([pscustomobject]@{ step = 'one'; passed = $true; detail = '' })
    $installer = [ordered]@{ name = 'x_0.1.2_x64-setup.exe'; sha256 = 'ab'; product = 'nq-lab terminal installtest'; identifier = 'dev.nqlab.terminal.installtest'; version = '0.1.2' }
    $stamp = [pscustomobject]@{ head = 'h'; diff_sha256 = 'd'; untracked_sha256 = 'u' }
    $guard = [ordered]@{ unchanged = $true; problems = @() }
    $record = New-InstallRecord 'install' $steps $installer $null $guard $stamp 'r.json' '2026-10-05' 'PC' $false 'nq-lab terminal'
    Expect 'a clean run records exit code 0, the renamed variant, the version, HEAD and the stamp' (($record.exit_code -eq 0) -and ($record.variant -eq 'renamed') -and ($record.version -eq '0.1.2') -and ($record.head -eq 'h') -and ($record.steps_passed -eq 1) -and ($record.self_test -eq $false))
    $failing = @($steps) + @([pscustomobject]@{ step = 'two'; passed = $false; detail = '' })
    Expect 'a run with a failed step records exit code 1 (born failing)' ((New-InstallRecord 'install' $failing $installer $null $guard $stamp 'r' 'd' 'PC' $false 'nq-lab terminal').exit_code -eq 1)
    Expect 'a run whose guard saw the real install change records exit code 1 (born failing)' ((New-InstallRecord 'install' $steps $installer $null ([ordered]@{ unchanged = $false; problems = @('x') }) $stamp 'r' 'd' 'PC' $false 'nq-lab terminal').exit_code -eq 1)
    Expect 'a run with no steps records exit code 1' ((New-InstallRecord 'install' @() $installer $null $guard $stamp 'r' 'd' 'PC' $false 'nq-lab terminal').exit_code -eq 1)
    Expect 'a record of the real product says variant release' ((New-InstallRecord 'install' $steps ([ordered]@{ product = 'nq-lab terminal'; version = '0.1.2' }) $null $guard $stamp 'r' 'd' 'PC' $false 'nq-lab terminal').variant -eq 'release')
    $folder = Join-Path $ScratchTemp ('worktree-self-test-' + [guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Force -Path (Join-Path $folder 'real') | Out-Null
        Expect 'a folder without links holds no reparse point' ((Get-ReparsePoints $folder).Count -eq 0)
        New-Item -ItemType Junction -Path (Join-Path $folder 'link') -Target (Join-Path $folder 'real') | Out-Null
        Expect 'a junction inside a worktree is found, so it is never removed with --force (born failing)' ((Get-ReparsePoints $folder).Count -eq 1)
    } finally {
        $link = Join-Path $folder 'link'
        if (Test-Path -LiteralPath $link) { (Get-Item -LiteralPath $link -Force).Delete() }
        if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
    }
    $overlay = Get-Content -Raw -Path $OverlayFile -Encoding UTF8 | ConvertFrom-Json
    $base = Get-Content -Raw -Path (Join-Path $Crate 'tauri.conf.json') -Encoding UTF8 | ConvertFrom-Json
    Expect 'the overlay renames both the product and the identifier of tauri.conf.json' (($overlay.productName -ne $base.productName) -and ($overlay.identifier -ne $base.identifier) -and ($overlay.identifier -like "$($base.identifier).*"))
    Expect 'the overlay carries no version, hooks or bundle settings (only the identity changes)' (@($overlay.PSObject.Properties.Name | Where-Object { $_ -notin '$schema', 'productName', 'identifier' }).Count -eq 0)
}

function Invoke-SelfTest {
    $good = "!define PRODUCTNAME `"p`"`n!define MANUFACTURER `"m`"`n!define MAINBINARYNAME `"b`"`n!define INSTALLMODE `"currentUser`"`n" + '${GetOptions} $CMDLINE "/NS" $N' + "`n" + '${GetOptions} $CMDLINE "/R" $R0'
    Expect 'a script with /NS and /R and currentUser passes' ((Get-ScriptProblems (Read-InstallerScript $good)).Count -eq 0)
    Expect 'a script without /NS fails (born failing)' ((Get-ScriptProblems (Read-InstallerScript ($good -replace '/NS', '/XX'))).Count -gt 0)
    Expect 'a perMachine script fails (born failing)' ((Get-ScriptProblems (Read-InstallerScript ($good -replace 'currentUser', 'perMachine'))).Count -gt 0)
    Expect 'a target outside D:\dev is refused (born failing)' ((Get-TargetProblems 'C:\Users\x\install' @()).Count -gt 0)
    Expect 'a target on D:\dev is accepted' ((Get-TargetProblems 'D:\dev\d5\install\self-test-never-created' @()).Count -eq 0)
    Expect 'an existing product key is refused (born failing)' ((Get-TargetProblems 'D:\dev\d5\install\self-test-never-created' @('HKCU:\x')).Count -gt 0)
    Expect 'a new visible window is reported by the diff (born failing)' ([NqtWindowWatch]::NewVisible([long[]]@(1, 2), [long[]]@(1, 2, 3)).Count -eq 1)
    Expect 'an unchanged window set reports nothing' ([NqtWindowWatch]::NewVisible([long[]]@(1, 2), [long[]]@(2, 1)).Count -eq 0)
    Expect 'a changed foreground window is reported (born failing)' ([NqtWindowWatch]::ForegroundChanged(5, 6))
    Expect 'an unchanged or null foreground is not a change' (-not [NqtWindowWatch]::ForegroundChanged(5, 5) -and -not [NqtWindowWatch]::ForegroundChanged(5, 0))
    $found = Get-WatchFindings @('window|1|99|D:\dev\d5\install\x\a.exe|c|t|0,0,1,1', 'window|2|98|C:\Other\b.exe|c|t|0,0,1,1') 'D:\dev\d5\install\x' @()
    Expect 'a window of the install folder is ours and another program is foreign' (@($found.ours).Count -eq 1 -and @($found.foreign).Count -eq 1)
    $scratch = Get-AclReport $ScratchTemp
    Expect 'the scratch TEMP is a fresh run folder under the shared scratch folder, not the shared folder itself (born failing)' ($ScratchTemp -ne $ScratchBase -and $ScratchTemp.StartsWith($ScratchBase + '\', [System.StringComparison]::OrdinalIgnoreCase) -and $env:TEMP -eq $ScratchTemp -and $env:TMP -eq $ScratchTemp)
    Expect 'the scratch TEMP the installer runs from is protected: no inheritance, no broad writer (born failing)' ($scratch.protected -and @($scratch.writable_by_broad_groups).Count -eq 0)
    Test-AclSelfTest
    Test-CustomFolderSelfTest
    Test-GuardSelfTest
    Test-IdentitySelfTest
    [NqtWindowWatch]::Start()
    Start-Sleep -Milliseconds 1200
    $events = [NqtWindowWatch]::Stop()
    Write-Host "NOTE  live dry run of the watcher: $(@($events).Count) events on this machine: $($events -join ' || ')"
    if ($Installer) {
        $path = (Resolve-Path $Installer).Path
        $scriptPath = Find-InstallerScript $path
        Expect 'the real installer script is found and passes' (($null -ne $scriptPath) -and ((Get-ScriptProblems (Read-InstallerScript (Get-Content -Raw -Path $scriptPath -Encoding UTF8))).Count -eq 0))
    }
}

# ---- main --------------------------------------------------------------------------------------------------------------------

try {
$cBefore = [math]::Round((Get-PSDrive C).Free / 1MB)
function Resolve-OneFile {
    param([string]$Pattern, [string]$Name)
    $resolved = @(Resolve-Path $Pattern -ErrorAction SilentlyContinue)
    if ($resolved.Count -ne 1) { Write-Host "ERROR  $Name '$Pattern' matches $($resolved.Count) files, expected 1"; exit 2 }
    return $resolved[0].Path
}

if ($SelfTest) {
    Invoke-SelfTest
} elseif ($BuildRenamed) {
    $built = Invoke-RenamedBuild $BuildRenamed $BuildVersion
    if ($built) { Write-Host "installer: $built" } else { Add-Result 'build: an installer' $false 'no installer (see the steps above)' }
} else {
    if (-not $Installer) { Write-Host 'ERROR  give -Installer <path to the setup exe> (or -SelfTest, or -BuildRenamed <ref>)'; exit 2 }
    if ($Upgrade -and -not $FromInstaller) { Write-Host 'ERROR  -Upgrade needs -FromInstaller <the older installer of the same renamed product>'; exit 2 }
    if ($FromInstaller -and -not $Upgrade) { Write-Host 'ERROR  -FromInstaller is only used with -Upgrade'; exit 2 }
    $installerPath = Resolve-OneFile $Installer '-Installer'
    $fromPath = if ($Upgrade) { Resolve-OneFile $FromInstaller '-FromInstaller' } else { '' }
    $hooks = @(foreach ($hook in 'RealUninstallRoot', 'RealManufacturerRoot', 'RealStateRoot', 'RealProgramsRoot') { if ($PSBoundParameters.ContainsKey($hook)) { $hook } })
    if ($hooks.Count -gt 0) { Write-Host "WARN  a test hook moves the real install guard ($($hooks -join ', ')): this run does not guard the real install" }
    $script:Report = $null
    $script:Tested = $null
    if (-not $Run) { $Run = 'run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
    $guardBefore = Get-RealGuardSnapshot
    $guard = $null
    try {
        if ($Upgrade) { Invoke-UpgradeTest $fromPath $installerPath } else { Invoke-InstallTest $installerPath }
    } catch {
        Add-Result 'the run finished without an error' $false "$($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))"
    } finally {
        $guard = Test-RealGuard $guardBefore
    }
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    $reportFile = Join-Path $InstallRoot "$Run.report.json"
    $body = [ordered]@{ finished_utc = (Get-Date).ToUniversalTime().ToString('o'); pc = $env:COMPUTERNAME; scenario = $(if ($Upgrade) { 'upgrade' } else { 'install' }); steps = $Results; detail = $script:Report; real_install_guard = $guard }
    [System.IO.File]::WriteAllText($reportFile, (($body | ConvertTo-Json -Depth 8) + "`n"), $Utf8)
    Write-Host "report: $reportFile"
    $toFacts = if ($null -ne $script:Tested) { $script:Tested.to } else { $null }
    $fromRecord = if ($Upgrade) { Get-InstallerRecord $fromPath $(if ($null -ne $script:Tested -and $script:Tested.ContainsKey('from')) { $script:Tested.from } else { $null }) } else { $null }
    $record = New-InstallRecord $(if ($Upgrade) { 'upgrade' } else { 'install' }) $Results (Get-InstallerRecord $installerPath $toFacts) $fromRecord $guard (Get-TreeStamp) $reportFile (Get-Date).ToString('yyyy-MM-dd') $env:COMPUTERNAME $AllowForeign.IsPresent (Get-RealProduct).Product
    $recordFile = Write-InstallRecord $record
    Write-Host "record: $recordFile (exit code $($record.exit_code), installer sha256 $(if ($record.installer) { $record.installer.sha256 } else { 'none' }), HEAD $($record.head))"
}
$cAfter = [math]::Round((Get-PSDrive C).Free / 1MB)
$failed = @($Results | Where-Object { -not $_.passed })
Write-Host ("install-test: {0} steps, {1} failed; C: free {2} MB before, {3} MB after" -f $Results.Count, $failed.Count, $cBefore, $cAfter)
if ($failed.Count -gt 0) { exit 1 }
exit 0
} finally {
    # exit inside the try still runs this: the run's private TEMP folder is deleted on every way out of the main part.
    try { if (Test-Path -LiteralPath $ScratchTemp) { Remove-Item -LiteralPath $ScratchTemp -Recurse -Force } } catch { Write-Host "NOTE  the scratch folder $ScratchTemp could not be deleted: $($_.Exception.Message)" }
}
