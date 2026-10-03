<#
.SYNOPSIS
  Silent per-user install and uninstall of a Tauri NSIS installer, with the window watch on (04 D5.4, D5.1).

.DESCRIPTION
  powershell -NoProfile -File desktop\scripts\install-test.ps1 -Installer D:\dev\release\0.1.0\<name>_0.1.0_x64-setup.exe
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
  The file is above the 800-line soft ceiling on purpose: one script owns one runnable scenario list and its self-test.
  Writes <InstallRoot>\<Run>.report.json and exits 0 only when every assertion holds.
.PARAMETER Installer
  The NSIS installer (a wildcard that matches one file is fine).
.PARAMETER DefaultFolder
  Also installs once with no /D= into the bundler's default, which the hooks move to %LOCALAPPDATA%\Programs\<product>, checks
  the folder is protected, uninstalls and removes what is left. It writes about 3 MB under the user's profile on C: for a few
  seconds, so it is a switch of its own; it refuses to run when the product is already installed there.
.PARAMETER SelfTest
  Born-failing checks of the guards (the script reader, the target refusals, the window diff) and a short live run of
  the watcher; installs nothing.
#>
[CmdletBinding()]
param(
    [string]$Installer = '',
    [string]$InstallRoot = 'D:\dev\d5\install',
    [string]$Run = '',
    [string]$CustomRoot = 'D:\dev\tmp\dec1-apps',
    [switch]$AllowForeign,
    [switch]$DefaultFolder,
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$ScratchTemp = 'D:\dev\tmp\install-test'
$AllowedRoot = 'D:\dev\'
$InstallTimeoutSec = 180
$BundleMarkerBytes = 8
$RefusedExitCode = 3
$UninstallTimeoutSec = 120
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Results = New-Object System.Collections.Generic.List[object]

New-Item -ItemType Directory -Force -Path $ScratchTemp | Out-Null
$env:TEMP = $ScratchTemp
$env:TMP = $ScratchTemp

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
    param([string]$InstallerPath, [string]$Target, [System.Collections.Generic.List[int]]$Tracked, $AppSeen, [switch]$NoFolder)
    $start = Get-Date
    $arguments = if ($NoFolder) { '/S /NS' } else { "/S /NS /D=$Target" }
    try { $proc = Start-HiddenProcess $InstallerPath $arguments } catch {
        $code = if ($_.Exception.InnerException) { $_.Exception.InnerException.NativeErrorCode } else { 0 }
        return @{ ok = $false; detail = "the installer could not start without elevation or failed to start: $($_.Exception.Message) (native error $code)"; seconds = 0 }
    }
    $done = Wait-Silently $proc $InstallTimeoutSec $Target $Tracked $AppSeen
    $seconds = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
    if (-not $done) { return @{ ok = $false; detail = "the installer did not finish in $InstallTimeoutSec s"; seconds = $seconds } }
    return @{ ok = ($proc.ExitCode -eq 0); detail = "exit code $($proc.ExitCode) in $seconds s"; seconds = $seconds }
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
    $payload = @(Get-ChildItem (Split-Path $InstallerPath -Parent) -Recurse -Filter "$($Script.MainBinary).exe" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\payload\\' } | Select-Object -First 3)
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
    Test-AclSelfTest
    Test-CustomFolderSelfTest
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

$cBefore = [math]::Round((Get-PSDrive C).Free / 1MB)
if ($SelfTest) {
    Invoke-SelfTest
} else {
    if (-not $Installer) { Write-Error 'give -Installer <path to the setup exe> (or -SelfTest)'; exit 2 }
    $resolved = @(Resolve-Path $Installer -ErrorAction Stop)
    if ($resolved.Count -ne 1) { Write-Error "-Installer matches $($resolved.Count) files, expected 1"; exit 2 }
    $script:Report = $null
    if (-not $Run) { $Run = 'run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
    Invoke-InstallTest $resolved[0].Path
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    $reportFile = Join-Path $InstallRoot "$Run.report.json"
    $body = [ordered]@{ finished_utc = (Get-Date).ToUniversalTime().ToString('o'); pc = $env:COMPUTERNAME; steps = $Results; detail = $script:Report }
    [System.IO.File]::WriteAllText($reportFile, (($body | ConvertTo-Json -Depth 8) + "`n"), $Utf8)
    Write-Host "report: $reportFile"
}
$cAfter = [math]::Round((Get-PSDrive C).Free / 1MB)
$failed = @($Results | Where-Object { -not $_.passed })
Write-Host ("install-test: {0} steps, {1} failed; C: free {2} MB before, {3} MB after" -f $Results.Count, $failed.Count, $cBefore, $cAfter)
if ($failed.Count -gt 0) { exit 1 }
exit 0
