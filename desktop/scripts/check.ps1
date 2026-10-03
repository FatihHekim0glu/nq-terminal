# The local stand-in for the shell's CI job (03 section 16; 04 D4.1): every check of the crate, and with -Web the web
# checks of desktop-check.yml, in one run. Without -Web nothing here runs vitest, the contract hash or Playwright: those
# belong to the BASELINE list of the build plan (test:types, test, test:e2e-types, build, e2e, e2e:perf, e2e:offline,
# e2e:desktop, the backend tests, the crosscheck and the real-data smoke), and the three workflow files are not written
# yet (desktop\README.md, Known limits).
#
#   powershell -NoProfile -File desktop\scripts\check.ps1 [-TargetDir D:\dev\targets\check] [-SkipSmokeRelease] [-Web]
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
# The supply-chain steps (D5.3; 05 X03 and X06; 03 section 16, the local stand-in for desktop-check.yml and the advisory
# part of webview2-drift.yml) are: deny (cargo deny check); deny-plant (born failing: stub crates carrying every banned
# name, the updater included, must each fail cargo deny, and a harmless control must pass); lock-names (a name pattern
# over Cargo.lock for the crate families that cargo-deny cannot match by glob); audit; advisories (advisories.mjs: the
# Tauri repository's published advisories newer than state\desktop\advisories.json, network needed); dist-scan
# (dist-scan.mjs: no private key, signing key or PRIVATE marker in web\dist or a bundle folder); scripts-tests (the node
# tests of this folder, the artefact check's among them); harness-tests (the node tests of desktop\harness);
# release-check-tests and install-test-selftest (the release scripts' own born-failing tests); order-scan (the
# order-name text scan of src\*.rs in backend\tests\test_safety_ast.py).
# -SupplyChainOnly runs just those steps.
# -Web adds the web group after the other steps (alone, or after -SupplyChainOnly): web-test-types (pnpm test:types),
# web-vitest (pnpm test: the contract hash, then vitest), web-test-e2e-types (pnpm test:e2e-types) and web-e2e-offline
# (pnpm e2e:offline, the offline Playwright projects). It needs web\node_modules (a junction is fine) and, for the
# Playwright step, a quiet machine: the step waits up to 15 minutes for any other Playwright or vitest run to end and
# fails if one is still running, since only one such run may exist at a time.
[CmdletBinding()]
param(
    [string]$TargetDir = 'D:\dev\targets\check',
    [string]$LogRoot = 'D:\dev\tmp\check',
    [string]$Python = 'C:\Users\Fatih Hekimoglu\nq-lab\.venv\Scripts\python.exe',
    [switch]$SkipSmokeRelease,
    [switch]$ShowProof,
    [switch]$SupplyChainOnly,
    [switch]$Web
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
    $first = (Get-Content (Join-Path $LogDir "$Name.log") -TotalCount 1) -join ''
    Add-Result $Name ($code -eq 0) "exit $code $first"
}

function Step-DenyPlant {
    # Born failing, on every run: a throw-away workspace whose dependencies are empty stub crates named after every
    # entry of the deny list must fail `cargo deny check bans` once per name, and a workspace with one harmless stub
    # must pass, so the proof cannot pass by accident or fail for an unrelated reason.
    $config = Join-Path $Crate 'deny.toml'
    $names = @([regex]::Matches((Get-Content $config -Raw), '(?m)^\s*\{\s*name\s*=\s*"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
    $required = @('parquet', 'arrow', 'polars', 'duckdb', 'datafusion', 'ibapi', 'tauri-plugin-updater')
    $missing = @($required | Where-Object { $names -notcontains $_ })
    if ($missing.Count -gt 0) { Add-Result 'deny-plant' $false "deny.toml does not ban: $($missing -join ', ')"; return }
    $root = Join-Path $LogDir 'deny-plant'
    $control = New-DenyWorkspace (Join-Path $root 'control') @('plant-control-harmless')
    $plant = New-DenyWorkspace (Join-Path $root 'plant') $names
    $controlCode = Invoke-Logged -Name 'deny-plant-control' -File 'cargo' -WorkDir $control -Arguments @('deny', '--locked', '--manifest-path', (Join-Path $control 'Cargo.toml'), '--config', $config, 'check', 'bans')
    $plantCode = Invoke-Logged -Name 'deny-plant-banned' -File 'cargo' -WorkDir $plant -Arguments @('deny', '--locked', '--manifest-path', (Join-Path $plant 'Cargo.toml'), '--config', $config, 'check', 'bans')
    $text = Get-Content (Join-Path $LogDir 'deny-plant-banned.log') -Raw
    $notCaught = @($names | Where-Object { $text -notmatch "crate '$([regex]::Escape($_)) = 0\.0\.0' is explicitly banned" })
    $passed = ($controlCode -eq 0) -and ($plantCode -ne 0) -and ($notCaught.Count -eq 0)
    Add-Result 'deny-plant' $passed "control exit $controlCode, planted exit $plantCode, $($names.Count - $notCaught.Count) of $($names.Count) banned names caught$(if ($notCaught.Count -gt 0) { ', not caught: ' + ($notCaught -join ', ') })"
}

function New-DenyWorkspace {
    # A package named plant that depends on one empty path crate per name; offline, so no registry is touched.
    param([string]$Folder, [string[]]$Names)
    $manifest = New-Object System.Collections.Generic.List[string]
    $manifest.AddRange([string[]]@('[package]', 'name = "plant"', 'version = "0.0.0"', 'edition = "2021"', '', '[dependencies]'))
    foreach ($name in $Names) {
        $stub = Join-Path $Folder "stubs\$name"
        New-Item -ItemType Directory -Force -Path (Join-Path $stub 'src') | Out-Null
        Set-Content -Path (Join-Path $stub 'Cargo.toml') -Encoding ascii -Value "[package]`nname = `"$name`"`nversion = `"0.0.0`"`nedition = `"2021`"`n"
        Set-Content -Path (Join-Path $stub 'src\lib.rs') -Encoding ascii -Value ''
        $manifest.Add("$name = { path = `"stubs/$name`", version = `"0.0.0`" }")
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $Folder 'src') | Out-Null
    Set-Content -Path (Join-Path $Folder 'src\lib.rs') -Encoding ascii -Value ''
    Set-Content -Path (Join-Path $Folder 'Cargo.toml') -Encoding ascii -Value ($manifest -join "`n")
    $code = Invoke-Logged -Name "deny-plant-lock-$(Split-Path $Folder -Leaf)" -File 'cargo' -WorkDir $Folder -Arguments @('generate-lockfile', '--offline')
    if ($code -ne 0) { throw "cargo generate-lockfile failed for the planted workspace $Folder (exit $code)" }
    return $Folder
}

# Crate families the deny list cannot name by glob: data engines and broker clients (03 section 6 item 2), the updater.
$BannedFamilies = '^(arrow|parquet|polars|datafusion|duckdb)([-_0-9].*)?$|^libduckdb|^(rust-)?ibapi|^ib[-_](tws|api|async|client|insync)|^ibkr|^tws[-_]?(api|rs|client)?$|^twsapi|^tauri-plugin-updater$'

function Get-LockNames {
    param([string]$Text)
    return @([regex]::Matches($Text, '(?m)^name = "([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
}

function Step-LockNames {
    # Self-test first (born failing): the pattern must catch a planted lockfile of banned names and spare real ones.
    $planted = Get-LockNames ((@('arrow-select', 'polars-parquet', 'datafusion-physical-plan', 'duckdb', 'libduckdb-sys', 'ibapi', 'rust-ibapi', 'ib_async',
        'parquet2', 'ibkr-client', 'twsapi', 'tauri-plugin-updater') | ForEach-Object { "[[package]]`nname = `"$_`"`nversion = `"1.0.0`"`n" }) -join "`n")
    $spared = @('tauri', 'tao', 'windows', 'arrowhead', 'parquetry', 'ibm-thing', 'tauri-plugin-opener', 'tauri-runtime') | Where-Object { $_ -match $BannedFamilies }
    $selfOk = ($planted.Count -eq 12) -and (@($planted | Where-Object { $_ -notmatch $BannedFamilies }).Count -eq 0) -and (@($spared).Count -eq 0)
    $hits = @(Get-LockNames (Get-Content (Join-Path $Crate 'Cargo.lock') -Raw) | Where-Object { $_ -match $BannedFamilies })
    Add-Result 'lock-names' ($selfOk -and $hits.Count -eq 0) "self-test $(if ($selfOk) { 'ok' } else { 'FAILED' }), $($hits.Count) banned names in Cargo.lock $($hits -join ', ')"
}

function Test-TauriDevtoolsText {
    # True when a `cargo tree -e features -i tauri` listing shows tauri's devtools feature switched on.
    param([string]$Text)
    return $Text -match 'feature "devtools"'
}

function Step-DevtoolsFeature {
    # Self-test first (born failing): the match must catch a planted listing and spare a clean one. Then the real
    # listing of every feature set (release, measure, smoke): none may enable tauri's devtools feature.
    $planted = "tauri v2.12.1`n+-- tauri feature `"devtools`"`n    +-- nq-lab-terminal v0.1.0`n"
    $clean = "tauri v2.12.1`n+-- tauri feature `"common-controls-v6`"`n+-- tauri feature `"wry`"`n"
    $selfOk = (Test-TauriDevtoolsText $planted) -and -not (Test-TauriDevtoolsText $clean)
    $sets = [ordered]@{ release = @(); measure = @('--no-default-features', '--features', 'measure'); smoke = @('--no-default-features', '--features', 'smoke') }
    $bad = @(); $failed = @()
    foreach ($name in $sets.Keys) {
        $code = Invoke-Logged -Name "devtools-feature-$name" -File 'cargo' -Arguments (@('tree', '-e', 'features', '--locked', '--offline', '-i', 'tauri') + $sets[$name])
        if ($code -ne 0) { $failed += $name; continue }
        if (Test-TauriDevtoolsText (Get-Content (Join-Path $LogDir "devtools-feature-$name.log") -Raw)) { $bad += $name }
    }
    $detail = "self-test $(if ($selfOk) { 'ok' } else { 'FAILED' }), tauri devtools feature on in [$($bad -join ', ')], tree failed for [$($failed -join ', ')]"
    Add-Result 'devtools-feature' ($selfOk -and $bad.Count -eq 0 -and $failed.Count -eq 0) $detail
}

function Step-OrderScan {
    # The order-name text scan of the shell source and its born-failing cases, in the backend safety test.
    $env:PYTHONPATH = Join-Path $Terminal 'backend'
    $code = Invoke-Logged -Name 'order-scan' -File $Python -WorkDir $Terminal -Arguments @('-m', 'pytest', '-p', 'no:warnings', '-o', 'addopts=', '-q',
        '-k', 'rust', 'backend\tests\test_safety_ast.py')
    $summary = (Get-Content (Join-Path $LogDir 'order-scan.log') | Where-Object { $_ -match ' passed| failed| error' } | Select-Object -Last 1)
    Add-Result 'order-scan' ($code -eq 0) "exit $code $summary"
}

function Step-ScriptTests {
    $tests = @(Get-ChildItem (Join-Path $PSScriptRoot 'tests') -Filter '*.test.mjs' | ForEach-Object { $_.FullName })
    if ($tests.Count -eq 0) { Add-Result 'scripts-tests' $false 'no *.test.mjs files found'; return }
    $code = Invoke-Logged -Name 'scripts-tests' -File 'node' -WorkDir $Terminal -Arguments (@('--test') + $tests)
    $pass = (Get-Content (Join-Path $LogDir 'scripts-tests.log') | Where-Object { $_ -match '(^|\s)(pass|fail) \d+\s*$' } | ForEach-Object { $_.Trim() }) -join ', '
    Add-Result 'scripts-tests' ($code -eq 0) "exit $code, $($tests.Count) files, $pass"
}

function Step-HarnessTests {
    # The harness's own tests (Node 24 expands the glob itself; the harness has no dependencies).
    $code = Invoke-Logged -Name 'harness-tests' -File 'node' -WorkDir $Terminal -Arguments @('--test', 'desktop/harness/tests/*.test.mjs')
    $pass = (Get-Content (Join-Path $LogDir 'harness-tests.log') | Where-Object { $_ -match '(^|\s)(pass|fail) \d+\s*$' } | ForEach-Object { $_.Trim() }) -join ', '
    Add-Result 'harness-tests' ($code -eq 0) "exit $code, $pass"
}

function Step-ReleaseScripts {
    # The release scripts' own born-failing tests: release_check.tests.ps1 (records and stamps) and install-test.ps1 -SelfTest.
    $shell = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')
    $code = Invoke-Logged -Name 'release-check-tests' -File 'powershell' -WorkDir $Terminal -Arguments ($shell + @((Join-Path $Terminal 'scripts\tests\release_check.tests.ps1')))
    Add-Result 'release-check-tests' ($code -eq 0) "exit $code, log $LogDir\release-check-tests.log"
    $code = Invoke-Logged -Name 'install-test-selftest' -File 'powershell' -WorkDir $Terminal -Arguments ($shell + @((Join-Path $PSScriptRoot 'install-test.ps1'), '-SelfTest'))
    Add-Result 'install-test-selftest' ($code -eq 0) "exit $code, log $LogDir\install-test-selftest.log"
}

function Invoke-SupplyChainSteps {
    Step-Cargo 'deny' @('deny', '--locked', 'check')
    Step-DenyPlant
    Step-LockNames
    Step-DevtoolsFeature
    Step-Audit
    Step-Node 'advisories' @((Join-Path $PSScriptRoot 'advisories.mjs'))
    Step-Node 'dist-scan' @((Join-Path $PSScriptRoot 'dist-scan.mjs'), '--bundle', (Join-Path $TargetDir 'release\bundle'), '--bundle', 'D:\dev\release')
    Step-ScriptTests
    Step-HarnessTests
    Step-ReleaseScripts
    Step-OrderScan
}

function Wait-NoBrowserRun {
    # One Playwright or vitest run at a time on this machine: wait for another one to end (this process excluded).
    param([int]$TimeoutSeconds = 900)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $busy = @(Get-CimInstance Win32_Process | Where-Object {
            $_.ProcessId -ne $PID -and $_.CommandLine -match 'playwright|vitest' -and $_.CommandLine -notmatch 'check\.ps1'
        })
        if ($busy.Count -eq 0) { return $true }
        Start-Sleep -Seconds 10
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Step-Pnpm {
    param([string]$Name, [string]$Script)
    $web = Join-Path $Terminal 'web'
    if (-not (Test-Path (Join-Path $web 'node_modules'))) { Add-Result $Name $false "no web\node_modules (make a junction to the lab's, never install here)"; return }
    $code = Invoke-Logged -Name $Name -File 'corepack' -WorkDir $Terminal -Arguments @('pnpm', '--dir', $web, $Script)
    $tail = (Get-Content (Join-Path $LogDir "$Name.log") -Tail 1 -ErrorAction SilentlyContinue) -join ''
    Add-Result $Name ($code -eq 0) "exit $code, pnpm $Script, $tail"
}

function Invoke-WebSteps {
    # The web part of desktop-check.yml (03 section 16): types, vitest with the contract hash, the e2e type checks and
    # the offline Playwright projects (against the Node demo API; no backend, no lab).
    Step-Pnpm 'web-test-types' 'test:types'
    Step-Pnpm 'web-vitest' 'test'
    Step-Pnpm 'web-test-e2e-types' 'test:e2e-types'
    if (Wait-NoBrowserRun) { Step-Pnpm 'web-e2e-offline' 'e2e:offline' }
    else { Add-Result 'web-e2e-offline' $false 'another Playwright or vitest run was still going after 15 minutes' }
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
$supplyOnly = $SupplyChainOnly.IsPresent
$measure = @('--no-default-features', '--features', 'measure')
if ($supplyOnly) { Invoke-SupplyChainSteps } else {
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
Invoke-SupplyChainSteps
Step-Node 'look-css' @((Join-Path $PSScriptRoot 'copy-tokens.mjs'), '--check')
Step-Scope
if (-not $SkipSmokeRelease) { Step-SmokeRelease }
Step-ManifestWarnings
Step-NoBuildFolders
if (-not $ShowProof) { Write-Host 'NOTE  show-proof  not run: pass -ShowProof (needs screen 2) for the born-failing no-show proof' }
}
if ($Web) { Invoke-WebSteps }

$failed = @($Results | Where-Object { -not $_.Passed })
$cAfter = [math]::Round((Get-PSDrive C).Free / 1MB)
Write-Host ''
Write-Host ("check.ps1: {0} steps, {1} failed; C: free {2} MB before, {3} MB after" -f $Results.Count, $failed.Count, $cDrive, $cAfter)
$Results | ConvertTo-Json | Set-Content -Path (Join-Path $LogDir 'summary.json') -Encoding utf8
if ($failed.Count -gt 0) { exit 1 }
exit 0
