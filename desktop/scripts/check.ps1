# The local stand-in for the shell's CI job (03 section 16; 04 D4.1): every check the crate must pass, in one run.
#
#   powershell -NoProfile -File desktop\scripts\check.ps1 [-TargetDir D:\dev\targets\w4a] [-SkipSmokeRelease]
#
# Steps: rustfmt --check; Clippy with -D warnings for the default (release), smoke and measure feature sets;
# cargo test for the default and smoke sets (the smoke set launches the hidden smoke exe against the fixture
# backend, see tests\hidden_window.rs); cargo deny; cargo audit (any advisory for a crate in the Windows build graph
# fails); the look.css freshness and contrast check; the module scope scan; the release-profile smoke exe built
# through cargo-tauri; pe-info import and manifest checks of the debug and smoke exes; the pinned WebView2Loader.dll;
# no manifest merge warning in any build log; and no target or node_modules folder under desktop\.
# The measure feature set is linted, tested and pe-info checked like smoke. Its test run (test-measure) launches the
# hidden measure exe from tests\hidden_window.rs with NQT_MEASURE_DIR naming a run folder under D:\dev (the exe takes
# no switch; its lab comes from the settings file the test plants, and its backend is a stand-in that waits for its
# stdin, so its HOME load belongs to the measurement run), and tests\show_scope.rs scans every feature set statically for a show() outside the release cfg.
# -ShowProof also runs the born-failing proof, per feature, that the watch catches a build calling show() (it shows
# one window for a moment on screen 2 and refuses to run without that monitor; a skip counts as a failure here).
# Everything runs --locked. Toolchain, caches and output stay under D:\dev; the owner's PATH is not changed.
[CmdletBinding()]
param(
    [string]$TargetDir = 'D:\dev\targets\w4a',
    [string]$LogRoot = 'D:\dev\tmp\w4a-check',
    [switch]$SkipSmokeRelease,
    [switch]$ShowProof
)

$ErrorActionPreference = 'Stop'
$Desktop = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Crate = Join-Path $Desktop 'src-tauri'
$Terminal = (Resolve-Path (Join-Path $Desktop '..')).Path
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogDir = Join-Path $LogRoot $Stamp
$LoaderSha256 = '86545B66CDB0603BC26B626FB9AD610CB6E71F28D468F5EA66DF23B03DDA96D5'
$ManifestWarning = 'multiple non-default manifests|\.rsrc merge failure'
$Results = New-Object System.Collections.Generic.List[object]

function Set-BuildEnvironment {
    # Per process only (04 standing rule 5).
    $env:RUSTUP_HOME = 'D:\dev\rustup'
    $env:CARGO_HOME = 'D:\dev\cargo'
    $env:PATH = "D:\dev\cargo\bin;D:\dev\mingw\mingw64\bin;$env:PATH"
    $env:TEMP = 'D:\dev\tmp'
    $env:TMP = 'D:\dev\tmp'
    $env:CARGO_TARGET_DIR = $TargetDir
    if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '8' }
    Get-ChildItem env: | Where-Object { $_.Name -like 'WEBVIEW2_*' } | ForEach-Object { Remove-Item "env:$($_.Name)" }
}

function Invoke-Logged {
    # Runs a native command with its output in a log file; returns the exit code.
    param([string]$Name, [string]$File, [string[]]$Arguments, [string]$WorkDir = $Crate)
    $log = Join-Path $LogDir "$Name.log"
    Push-Location $WorkDir
    try {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $File @Arguments *> $log
        $code = $LASTEXITCODE
        $ErrorActionPreference = $previous
    } finally {
        Pop-Location
    }
    return $code
}

function Add-Result {
    param([string]$Name, [bool]$Passed, [string]$Detail)
    $Results.Add([pscustomobject]@{ Step = $Name; Passed = $Passed; Detail = $Detail })
    $mark = if ($Passed) { 'PASS' } else { 'FAIL' }
    Write-Host ("{0}  {1}  {2}" -f $mark, $Name, $Detail)
}

function Step-Cargo {
    param([string]$Name, [string[]]$Arguments)
    $code = Invoke-Logged -Name $Name -File 'cargo' -Arguments $Arguments
    Add-Result $Name ($code -eq 0) "exit $code, log $LogDir\$Name.log"
}

function Step-PeInfo {
    param([string]$Name, [string]$Exe)
    if (-not (Test-Path $Exe)) { Add-Result $Name $false "missing $Exe"; return }
    $code = Invoke-Logged -Name $Name -File 'node' -Arguments @((Join-Path $PSScriptRoot 'pe-info.mjs'), $Exe, '--check')
    Add-Result $Name ($code -eq 0) "exit $code for $Exe"
}

function Step-PeInfoOfBuild {
    # The debug exe is one path for every feature set, so each check first builds its own set (a no-op when it is
    # fresh, which still puts that set's exe at the path) and reads the exe straight after.
    param([string]$Name, [string[]]$Features)
    $built = Invoke-Logged -Name "$Name-build" -File 'cargo' -Arguments (@('build', '--locked') + $Features)
    if ($built -ne 0) { Add-Result $Name $false "the build of this feature set failed (exit $built)"; return }
    Step-PeInfo $Name (Join-Path $TargetDir 'debug\nq-lab-terminal.exe')
}

function Step-Loader {
    param([string]$Exe)
    $dll = Join-Path (Split-Path $Exe) 'WebView2Loader.dll'
    if (-not (Test-Path $dll)) { Add-Result 'loader-pin' $false "no WebView2Loader.dll beside $Exe"; return }
    $hash = (Get-FileHash -Algorithm SHA256 $dll).Hash
    $signature = Get-AuthenticodeSignature $dll
    $signedByMicrosoft = $signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match 'O=Microsoft Corporation'
    Add-Result 'loader-pin' (($hash -eq $LoaderSha256) -and $signedByMicrosoft) "sha256 $hash, signature $($signature.Status)"
}

function Step-Audit {
    # Any advisory for a crate in the Windows build graph fails; one for a crate that only the lockfile's other
    # platforms pull in (the Linux GTK stack of Tauri) is listed, since `cargo tree -i` finds it nowhere here.
    $log = Join-Path $LogDir 'audit.json'
    Push-Location $Crate
    try {
        $ErrorActionPreference = 'Continue'
        $json = (& cargo audit --json 2> (Join-Path $LogDir 'audit.err.log')) -join "`n"
        $ErrorActionPreference = 'Stop'
    } finally { Pop-Location }
    Set-Content -Path $log -Value $json -Encoding utf8
    $report = $json | ConvertFrom-Json
    $found = @()
    $found += @($report.vulnerabilities.list | ForEach-Object { $_ })
    foreach ($kind in $report.warnings.PSObject.Properties) { $found += @($kind.Value | ForEach-Object { $_ }) }
    $inGraph = @(); $elsewhere = @()
    foreach ($item in $found) {
        $spec = "$($item.package.name)@$($item.package.version)"
        $tree = Invoke-Logged -Name "audit-tree-$($item.package.name)" -File 'cargo' -Arguments @('tree', '--locked', '--offline', '-e', 'normal,build', '-i', $spec)
        $text = Get-Content (Join-Path $LogDir "audit-tree-$($item.package.name).log") -Raw
        if ($text -match 'nothing to print') { $elsewhere += "$spec $($item.advisory.id)" } else { $inGraph += "$spec $($item.advisory.id)" }
    }
    $detail = "in the Windows graph: $($inGraph.Count) [$($inGraph -join ', ')]; other platforms only: $($elsewhere -join ', ')"
    Add-Result 'audit' ($inGraph.Count -eq 0 -and $null -ne $report) $detail
}

function Step-SmokeRelease {
    $code = Invoke-Logged -Name 'smoke-release-build' -File 'cargo' -WorkDir $Desktop -Arguments @(
        'tauri', 'build', '--no-bundle', '--features', 'smoke', '--config', 'src-tauri\tauri.smoke.conf.json',
        '--', '--locked', '--no-default-features')
    Add-Result 'smoke-release-build' ($code -eq 0) "exit $code"
    $exe = Join-Path $TargetDir 'release\nq-lab-terminal.exe'
    Step-PeInfo 'pe-info-smoke-release' $exe
    Step-Loader $exe
}

function Step-ShowProof {
    # The born-failing proof of tests\hidden_window.rs, per test feature: a copy of the crate that calls show()
    # must be caught by the same watch.
    param([string]$Feature)
    $name = "show-proof-$Feature"
    $code = Invoke-Logged -Name $name -File 'cargo' -Arguments @('test', '--locked', '--no-default-features',
        '--features', $Feature, '--test', 'hidden_window', '--', '--ignored', '--nocapture', '--test-threads=1',
        'a_build_that_calls_show_is_caught')
    $skipped = (Get-Content (Join-Path $LogDir "$name.log") -Raw) -match 'SKIPPED:'
    $head = (& git -C $Terminal rev-parse --short HEAD) -join ''
    Add-Result $name (($code -eq 0) -and -not $skipped) "exit $code, skipped $skipped, head $head, log $LogDir\$name.log"
}

function Step-ManifestWarnings {
    $hits = Get-ChildItem $LogDir -Filter '*.log' | Select-String -Pattern $ManifestWarning
    Add-Result 'manifest-warning' ($null -eq $hits) "$(@($hits).Count) hits of '$ManifestWarning' in the build logs"
}

function Step-NoBuildFolders {
    $found = Get-ChildItem $Desktop -Recurse -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'target' -or $_.Name -eq 'node_modules' }
    Add-Result 'no-target-or-node_modules' ($null -eq $found) "$(@($found).Count) found under $Desktop"
}

function Step-Node {
    param([string]$Name, [string[]]$Arguments)
    $code = Invoke-Logged -Name $Name -File 'node' -Arguments $Arguments -WorkDir $Terminal
    Add-Result $Name ($code -eq 0) "exit $code"
}

function Step-Scope {
    $code = Invoke-Logged -Name 'module-scope' -File 'powershell' -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', (Join-Path $PSScriptRoot 'plant-check.ps1'), '-ScopeOnly')
    Add-Result 'module-scope' ($code -eq 0) "exit $code"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-BuildEnvironment
$cDrive = [math]::Round((Get-PSDrive C).Free / 1MB)
Write-Host "check.ps1: crate $Crate, target $TargetDir, logs $LogDir, C: free $cDrive MB"

$smoke = @('--no-default-features', '--features', 'smoke')
$measure = @('--no-default-features', '--features', 'measure')
Step-Cargo 'fmt' @('fmt', '--check')
Step-Cargo 'clippy-default' (@('clippy', '--all-targets', '--locked', '--', '-D', 'warnings'))
Step-Cargo 'clippy-smoke' (@('clippy', '--all-targets', '--locked') + $smoke + @('--', '-D', 'warnings'))
Step-Cargo 'clippy-measure' (@('clippy', '--all-targets', '--locked') + $measure + @('--', '-D', 'warnings'))
Step-Cargo 'test-default' @('test', '--locked')
Step-PeInfoOfBuild 'pe-info-debug' @()
Step-Cargo 'test-smoke' (@('test', '--locked') + $smoke)
Step-PeInfoOfBuild 'pe-info-smoke-debug' $smoke
Step-Cargo 'test-measure' (@('test', '--locked') + $measure)
Step-PeInfoOfBuild 'pe-info-measure-debug' $measure
if ($ShowProof) { Step-ShowProof 'smoke'; Step-ShowProof 'measure' }
Step-Cargo 'deny' @('deny', '--locked', 'check')
Step-Audit
Step-Node 'look-css' @((Join-Path $PSScriptRoot 'copy-tokens.mjs'), '--check')
Step-Scope
if (-not $SkipSmokeRelease) { Step-SmokeRelease }
Step-ManifestWarnings
Step-NoBuildFolders
if (-not $ShowProof) { Write-Host 'NOTE  show-proof  not run: pass -ShowProof (needs screen 2) for the born-failing no-show proof' }

$failed = @($Results | Where-Object { -not $_.Passed })
$cAfter = [math]::Round((Get-PSDrive C).Free / 1MB)
Write-Host ''
Write-Host ("check.ps1: {0} steps, {1} failed; C: free {2} MB before, {3} MB after" -f $Results.Count, $failed.Count, $cDrive, $cAfter)
$Results | ConvertTo-Json | Set-Content -Path (Join-Path $LogDir 'summary.json') -Encoding utf8
if ($failed.Count -gt 0) { exit 1 }
exit 0
