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
       is recorded.
    5. The silent uninstall runs (it copies itself to TEMP and returns early, so the script waits for its process and
       the folder to go): no file is left, the HKCU uninstall entry is gone, no shortcut is left. The silent
       uninstaller leaves HKCU\Software\<manufacturer>\<product> (the install folder, kept for the next install); the
       script records that and removes it, because it created it.
    6. A global window watch (EnumWindows every 100 ms over every process, plus GetForegroundWindow) runs through the
       install and the uninstall: any new visible top-level window anywhere, or a change of foreground window, fails
       the run, with the window's process and title in the report. -AllowForeign downgrades those that belong to
       another program (not the installer, its folders or children) to warnings.
  Writes <InstallRoot>\<Run>.report.json and exits 0 only when every assertion holds.
.PARAMETER Installer
  The NSIS installer (a wildcard that matches one file is fine).
.PARAMETER SelfTest
  Born-failing checks of the guards (the script reader, the target refusals, the window diff) and a short live run of
  the watcher; installs nothing.
#>
[CmdletBinding()]
param(
    [string]$Installer = '',
    [string]$InstallRoot = 'D:\dev\d5\install',
    [string]$Run = '',
    [switch]$AllowForeign,
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$ScratchTemp = 'D:\dev\tmp\install-test'
$AllowedRoot = 'D:\dev\'
$InstallTimeoutSec = 180
$BundleMarkerBytes = 8
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

function Get-AclReport {
    param([string]$Folder)
    $acl = Get-Acl -LiteralPath $Folder
    $rules = @($acl.Access | ForEach-Object { [ordered]@{ identity = "$($_.IdentityReference)"; rights = "$($_.FileSystemRights)"; type = "$($_.AccessControlType)"; inherited = $_.IsInherited } })
    $broad = @($rules | Where-Object { $_.type -eq 'Allow' -and $_.identity -match 'Everyone|BUILTIN\\Users|Authenticated Users' -and $_.rights -match 'Write|Modify|FullControl' })
    return [ordered]@{ owner = "$($acl.Owner)"; sddl = $acl.Sddl; protected = $acl.AreAccessRulesProtected; rules = $rules
        writable_by_broad_groups = @($broad | ForEach-Object { "$($_.identity): $($_.rights)" }) }
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
    param([string]$InstallerPath, [string]$Target, [System.Collections.Generic.List[int]]$Tracked, $AppSeen)
    $start = Get-Date
    try { $proc = Start-HiddenProcess $InstallerPath "/S /NS /D=$Target" } catch {
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
    $report = [ordered]@{ installer = $InstallerPath; target = $target }

    [NqtWindowWatch]::Start()
    $install = Invoke-Install $InstallerPath $target $tracked $appSeen
    Add-Result 'silent install' $install.ok $install.detail
    if ($install.ok) {
        Test-InstalledFolder $target $facts $InstallerPath
        Test-InstallRegistry $facts $target $true
        Test-NoShortcuts $facts $shortcuts 'after install'
        Add-Result 'app not started' (@($appSeen).Count -eq 0 -and @(Get-ProcessesFrom $target).Count -eq 0) "seen: $($appSeen -join ', ')"
        $report['acl'] = Get-AclReport $target
        Write-Host "ACL: owner $($report['acl'].owner); protected $($report['acl'].protected); broad write: $($report['acl'].writable_by_broad_groups -join ', ')"
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
    $script:Report = $report
}

# ---- self-test -------------------------------------------------------------------------------------------------------------

function Expect {
    param([string]$Name, [bool]$Condition)
    Add-Result "self-test $Name" $Condition ''
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
