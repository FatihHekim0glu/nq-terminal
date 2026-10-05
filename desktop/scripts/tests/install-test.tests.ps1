# Born-failing tests of desktop\scripts\install-test.ps1 as a command (AUD-1, REL-05, REL-06).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\tests\install-test.tests.ps1
#
# The script's own -SelfTest covers its functions (the real install guard on a fake registry root, the identity and
# version refusals, the record). This file runs the script as the owner would and checks what it refuses before
# anything is installed: an installer of the real product while that is installed, another product that shares the
# real identifier, an upgrade that is not one, a bad ref for -BuildRenamed, missing arguments. Every installer here is a
# text file beside a generated installer.nsi, so nothing can be installed even if a guard failed; the real install guard
# is pointed at a fake registry root (HKCU\Software\nqt-install-tests-<id>) and fake folders under D:\dev\tmp, and the
# records go to a scratch folder.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Script = (Resolve-Path (Join-Path $PSScriptRoot '..\install-test.ps1')).Path
$Terminal = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Id = [guid]::NewGuid().ToString('N').Substring(0, 8)
$Scratch = Join-Path 'D:\dev\tmp\install-test-tests' $Id
$FakeRoot = "Registry::HKEY_CURRENT_USER\Software\nqt-install-tests-$Id"
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$RealProduct = (Get-Content -Raw -Path (Join-Path $Terminal 'desktop\src-tauri\tauri.conf.json') -Encoding UTF8 | ConvertFrom-Json)
$Today = (Get-Date).ToString('yyyy-MM-dd')
$Passed = 0
$Failed = New-Object System.Collections.Generic.List[string]

function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:Passed++; Write-Host "PASS  $Name" } else { $Failed.Add($Name); Write-Host "FAIL  $Name  $Detail" }
}

function Invoke-InstallTest {
    # The script in a child PowerShell (it calls exit); returns the exit code and the text.
    param([string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $text = (& powershell -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments 2>&1 | Out-String)
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    return @{ code = $code; text = $text }
}

function New-FakeInstaller {
    # A text file named like an installer, with the installer.nsi a real build leaves beside it (nsis\<build>\).
    param([string]$Name, [string]$Product, [string]$BundleId, [string]$Version)
    $dir = Join-Path $Scratch $Name
    New-Item -ItemType Directory -Force -Path (Join-Path $dir 'nsis\installtest') | Out-Null
    $nsi = @(
        "!define MANUFACTURER `"nqlab`"", "!define PRODUCTNAME `"$Product`"", "!define VERSION `"$Version`"",
        "!define MAINBINARYNAME `"nq-lab-terminal`"", "!define BUNDLEID `"$BundleId`"", "!define INSTALLMODE `"currentUser`"",
        '${GetOptions} $CMDLINE "/NS" $NoShortcutMode', '${GetOptions} $CMDLINE "/R" $R0') -join "`n"
    [System.IO.File]::WriteAllText((Join-Path $dir 'nsis\installtest\installer.nsi'), $nsi + "`n", $Utf8)
    $file = Join-Path $dir "${Product}_${Version}_x64-setup.exe"
    [System.IO.File]::WriteAllText($file, 'not an installer', $Utf8)
    return $file
}

function Get-HookArguments {
    # The real install guard pointed at the fake roots; scratch install, custom and record folders.
    param([string]$Case)
    return @('-RealUninstallRoot', "$FakeRoot\Uninstall", '-RealManufacturerRoot', "$FakeRoot\nqlab", '-RealStateRoot', (Join-Path $Scratch 'state'),
        '-RealProgramsRoot', (Join-Path $Scratch 'programs'), '-InstallRoot', (Join-Path $Scratch "install-$Case"), '-CustomRoot', (Join-Path $Scratch "custom-$Case"),
        '-RecordDir', (Join-Path $Scratch "records-$Case"), '-Run', $Case)
}

function Read-Record {
    param([string]$Case, [string]$Scenario)
    $file = Join-Path $Scratch "records-$Case\${Today}_$Scenario.json"
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    return (Get-Content -Raw -Path $file -Encoding UTF8 | ConvertFrom-Json)
}

function Set-FakeRealInstall {
    # The fake "real" product: its uninstall key (InstallLocation a fake folder), remembered folder and files.
    param([bool]$Installed, [bool]$State)
    if (Test-Path -LiteralPath $FakeRoot) { Remove-Item -LiteralPath $FakeRoot -Recurse -Force }
    New-Item -Path "$FakeRoot\Uninstall" -Force | Out-Null
    New-Item -Path "$FakeRoot\nqlab" -Force | Out-Null
    $app = Join-Path $Scratch "programs\$($RealProduct.productName)"
    if ($Installed) {
        $key = "$FakeRoot\Uninstall\$($RealProduct.productName)"
        New-Item -Path $key -Force | Out-Null
        New-ItemProperty -LiteralPath $key -Name 'DisplayVersion' -Value '0.1.1' -PropertyType String | Out-Null
        New-ItemProperty -LiteralPath $key -Name 'InstallLocation' -Value "`"$app`"" -PropertyType String | Out-Null
        New-Item -ItemType Directory -Force -Path $app | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $app 'nq-lab-terminal.exe'), 'fake real exe', $Utf8)
    }
    $stateDir = Join-Path $Scratch "state\$($RealProduct.identifier)"
    if ($State) { New-Item -ItemType Directory -Force -Path $stateDir | Out-Null; [System.IO.File]::WriteAllText((Join-Path $stateDir 'settings.json'), '{}', $Utf8) }
    elseif (Test-Path -LiteralPath $stateDir) { Remove-Item -LiteralPath $stateDir -Recurse -Force }
}

New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
try {
    # ---- the self-test ------------------------------------------------------------------------------------------------
    $r = Invoke-InstallTest @('-SelfTest')
    $passLines = @([regex]::Matches($r.text, '(?m)^PASS  self-test ')).Count
    Check 'the self-test passes' ($r.code -eq 0) $r.text
    Check 'the self-test runs at least 68 checks' ($passLines -ge 68) "$passLines"
    foreach ($name in 'a changed value of the real uninstall key is detected (born failing)', 'a removed real uninstall key is detected (born failing)',
        'a file added to the real install folder is detected (born failing)', 'the real product is refused while it is installed (born failing)',
        'an upgrade to the same version is refused (born failing)', 'a run whose guard saw the real install change records exit code 1 (born failing)') {
        Check "the self-test includes: $name" ($r.text -match [regex]::Escape("PASS  self-test $name"))
    }

    # ---- arguments ------------------------------------------------------------------------------------------------------
    $r = Invoke-InstallTest @('-Upgrade', '-Installer', 'D:\dev\tmp\nothing.exe')
    Check '-Upgrade without -FromInstaller is refused with exit code 2' (($r.code -eq 2) -and ($r.text -match 'needs -FromInstaller'))
    $r = Invoke-InstallTest @('-FromInstaller', 'D:\dev\tmp\a.exe', '-Installer', 'D:\dev\tmp\b.exe')
    Check '-FromInstaller without -Upgrade is refused with exit code 2' (($r.code -eq 2) -and ($r.text -match 'only used with -Upgrade'))
    $r = Invoke-InstallTest @('-Installer', (Join-Path $Scratch 'missing_0.1.1_x64-setup.exe'))
    Check 'an installer path that matches no file is refused with exit code 2' ($r.code -eq 2)

    # ---- the real product while it is installed ------------------------------------------------------------------------
    Set-FakeRealInstall $true $true
    $installer = New-FakeInstaller 'real' $RealProduct.productName $RealProduct.identifier '9.9.9'
    $r = Invoke-InstallTest (@('-Installer', $installer) + (Get-HookArguments 'real'))
    Check 'the real product is refused while the (fake) real install exists (born failing)' (($r.code -eq 1) -and ($r.text -match 'FAIL  a renamed product beside the real install')) $r.text
    Check 'nothing was installed: no install step ran' ($r.text -notmatch 'silent install')
    Check 'the run says a test hook moved the real install guard' ($r.text -match 'WARN  a test hook moves the real install guard')
    Check 'the guard passed on the untouched fake real install' ($r.text -match 'PASS  the real install is untouched')
    $record = Read-Record 'real' 'install'
    Check 'a refused run still writes its record, with exit code 1 and the failed step' (($null -ne $record) -and ($record.exit_code -eq 1) -and (@($record.failed_steps) -contains 'a renamed product beside the real install'))
    Check 'the record names the installer by sha256 and the tree by its stamp' (($null -ne $record) -and ($record.installer.sha256 -eq (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()) -and ($record.head -match '^[0-9a-f]{40}$') -and ($null -ne $record.stamp))

    # ---- another product that shares the real identifier ----------------------------------------------------------------
    Set-FakeRealInstall $false $true
    $installer = New-FakeInstaller 'same-id' 'nqt fake product' $RealProduct.identifier '9.9.9'
    $r = Invoke-InstallTest (@('-Installer', $installer) + (Get-HookArguments 'same-id'))
    Check 'a renamed product that keeps the real identifier is refused while the real state exists (born failing)' (($r.code -eq 1) -and ($r.text -match 'FAIL  a renamed product beside the real install') -and ($r.text -notmatch 'silent install')) $r.text

    # ---- an upgrade that is not one ---------------------------------------------------------------------------------------
    Set-FakeRealInstall $true $true
    $new = New-FakeInstaller 'up-new' 'nqt fake product' 'dev.nqt.fake' '0.1.1'
    $old = New-FakeInstaller 'up-old' 'nqt fake product' 'dev.nqt.fake' '0.1.2'
    $r = Invoke-InstallTest (@('-Upgrade', '-FromInstaller', $old, '-Installer', $new) + (Get-HookArguments 'down'))
    Check 'an "upgrade" from 0.1.2 to 0.1.1 is refused before anything is installed (born failing)' (($r.code -eq 1) -and ($r.text -match 'FAIL  upgrade refusals') -and ($r.text -match 'not an upgrade') -and ($r.text -notmatch 'install 0\.1\.2')) $r.text
    $record = Read-Record 'down' 'upgrade'
    Check 'the refused upgrade writes an upgrade record with exit code 1' (($null -ne $record) -and ($record.check -eq 'upgrade') -and ($record.exit_code -eq 1) -and ($record.from_installer.version -eq '0.1.2'))
    $other = New-FakeInstaller 'up-other' 'nqt other product' 'dev.nqt.other' '0.1.3'
    $r = Invoke-InstallTest (@('-Upgrade', '-FromInstaller', $new, '-Installer', $other) + (Get-HookArguments 'pair'))
    Check 'an upgrade between two products is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'differ in Product'))
    $realNew = New-FakeInstaller 'up-real' $RealProduct.productName $RealProduct.identifier '9.9.9'
    $realOld = New-FakeInstaller 'up-real-old' $RealProduct.productName $RealProduct.identifier '9.9.8'
    Set-FakeRealInstall $false $false
    $r = Invoke-InstallTest (@('-Upgrade', '-FromInstaller', $realOld, '-Installer', $realNew) + (Get-HookArguments 'real-up'))
    Check 'the upgrade scenario refuses the real product even when the (fake) real install is absent (born failing)' (($r.code -eq 1) -and ($r.text -match 'runs only on a renamed product'))

    # ---- -BuildRenamed ----------------------------------------------------------------------------------------------------
    $before = @(& git -C $Terminal worktree list).Count
    $r = Invoke-InstallTest @('-BuildRenamed', 'refs/tags/no-such-tag-for-install-tests', '-BuildOut', (Join-Path $Scratch 'build'))
    Check 'a ref that names no commit is refused and builds nothing' (($r.code -eq 1) -and ($r.text -match 'is not a commit') -and -not (Test-Path -LiteralPath (Join-Path $Scratch 'build')))
    Check 'no worktree was added' (@(& git -C $Terminal worktree list).Count -eq $before)
    $r = Invoke-InstallTest @('-BuildRenamed', 'HEAD', '-TargetDir', 'C:\targets\x', '-BuildOut', (Join-Path $Scratch 'build'))
    Check 'a target folder outside D:\dev\targets is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'target folder under D:\\dev\\targets'))
} finally {
    if (Test-Path -LiteralPath $FakeRoot) { Remove-Item -LiteralPath $FakeRoot -Recurse -Force }
    if (Test-Path -LiteralPath $Scratch) { Remove-Item -LiteralPath $Scratch -Recurse -Force }
}
Check 'the fake registry root and the scratch folder are gone' (-not (Test-Path -LiteralPath $FakeRoot) -and -not (Test-Path -LiteralPath $Scratch))

Write-Host ''
Write-Host ("install-test tests: {0} passed, {1} failed" -f $Passed, $Failed.Count)
if ($Failed.Count -gt 0) { Write-Host ("FAILED: " + ($Failed -join '; ')); exit 1 }
exit 0
