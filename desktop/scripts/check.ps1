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
# release-check-tests, install-test-selftest, install-test-tests and upgrade-owner-tests (the release scripts' own born-failing tests); order-scan (the
# order-name text scan of src\*.rs in backend\tests\test_safety_ast.py).
# -SupplyChainOnly runs just those steps. The full run also ends with parity (perf-5: the fixture backend started the shell's way and the plain way, no window).
# -Web adds the web group after the other steps (alone, or after -SupplyChainOnly): web-test-types (pnpm test:types),
# web-vitest (pnpm test: the contract hash, then vitest), web-test-e2e-types (pnpm test:e2e-types) and web-e2e-offline
# (pnpm e2e:offline, the offline Playwright projects). It needs web\node_modules (a junction is fine) and, for the
# Playwright step, a quiet machine: the step waits up to 15 minutes for any other Playwright or vitest run to end and
# fails if one is still running, since only one such run may exist at a time.
# Preflight (AUD-3), before anything is built: web\dist must exist and be at least as new as the newest web\src file (test files
# aside), because a stale dist makes the smoke tests fail with the misleading "HOME never became ready"; and no concurrent build
# may hold the target folder (another check.ps1 run, which keeps target\check.lock open, or a cargo build, which holds
# .cargo-lock under target\<profile>), nor may a pnpm or vite build of this web folder be running. A preflight failure prints
# FAIL preflight lines and exits 3 without running a step. -SkipPreflight turns it off, -PreflightOnly runs just the preflight,
# -WebDir names another web folder, -PreflightSelfTest runs the born-failing cases of the preflight itself.
# Serialised with the backend tests: a backend pytest session holds D:\dev\locks\PYTEST.<pid>.lock while it runs (stale after 2 h).
# Before every step that starts a backend or the smoke exe (test-smoke, test-measure, show-proof, parity) this script polls every
# 30 s while a fresh lock exists, prints each wait, records the wait as a step, and fails the step after 2 h of waiting (exit 4 with
# -PytestWaitOnly, which only waits: -PytestLockDir, -PytestWaitPollSeconds and -PytestWaitTimeoutSeconds name another folder and times).
[CmdletBinding()]
param(
    [string]$TargetDir = 'D:\dev\targets\check',
    [string]$LogRoot = 'D:\dev\tmp\check',
    [string]$Python = 'C:\Users\Fatih Hekimoglu\nq-lab\.venv\Scripts\python.exe',
    [switch]$SkipSmokeRelease,
    [switch]$ShowProof,
    [switch]$SupplyChainOnly,
    [switch]$Web,
    [string]$WebDir = '',
    [switch]$SkipPreflight,
    [switch]$PreflightOnly,
    [int]$PreflightHoldSeconds = 0,
    [switch]$PreflightSelfTest,
    [string]$PytestLockDir = $(if ($env:NQT_LOCK_DIR) { $env:NQT_LOCK_DIR } else { 'D:\dev\locks' }),
    [int]$PytestWaitPollSeconds = 30,
    [int]$PytestWaitTimeoutSeconds = 7200,
    [switch]$PytestWaitOnly
)

$ErrorActionPreference = 'Stop'
$Desktop = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Crate = Join-Path $Desktop 'src-tauri'
$Terminal = (Resolve-Path (Join-Path $Desktop '..')).Path
if (-not $WebDir) { $WebDir = Join-Path $Terminal 'web' }
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

function Set-SeamRequirement {
    # The seam tests (tests\int1_seams.rs, and the page-source check of src\save_outcome.rs) run on the lab this tree
    # sits in and print SKIPPED in any other tree, which cargo reports as passed. In the lab's own tree that skip is a
    # failure: NQT_REQUIRE_SEAMS=1 makes those tests panic instead. In another tree (a worktree, a clone) the skip
    # stays, and this run says so, so that a green check there is never read as a proof of the seams.
    $lab = if ($env:NQT_LAB) { $env:NQT_LAB } else { Join-Path $env:USERPROFILE 'nq-lab' }
    $theirs = Join-Path $lab 'terminal'
    $sameTree = (Test-Path $theirs) -and ((Resolve-Path $theirs).Path.TrimEnd([char]92) -ieq $Terminal.TrimEnd([char]92))
    if ($sameTree) {
        $env:NQT_REQUIRE_SEAMS = '1'
    } else {
        Remove-Item Env:NQT_REQUIRE_SEAMS -ErrorAction SilentlyContinue
        Write-Host "NOTE  seams  this tree ($Terminal) is not the lab's terminal folder ($theirs): the seam tests SKIP here and prove nothing; run check.ps1 in the lab's own tree"
    }
    return $sameTree
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
    if (-not (Wait-NoPytestLock 'show-proof')) { return }
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
    # install-test.ps1 as a command with fake real roots (nothing is installed), and upgrade-owner.ps1's self-test plus a read-only dry run.
    $code = Invoke-Logged -Name 'install-test-tests' -File 'powershell' -WorkDir $Terminal -Arguments ($shell + @((Join-Path $PSScriptRoot 'tests\install-test.tests.ps1')))
    Add-Result 'install-test-tests' ($code -eq 0) "exit $code, log $LogDir\install-test-tests.log"
    $code = Invoke-Logged -Name 'upgrade-owner-tests' -File 'powershell' -WorkDir $Terminal -Arguments ($shell + @((Join-Path $PSScriptRoot 'tests\upgrade-owner.tests.ps1')))
    Add-Result 'upgrade-owner-tests' ($code -eq 0) "exit $code, log $LogDir\upgrade-owner-tests.log"
}

function Step-Parity {
    # perf-5: the fixture backend started the way the shell starts it and the plain way holds the same private working set and thread count.
    # Fixture data, two spare ports, no window; the harness mode ends only the processes it started.
    if (-not (Wait-NoPytestLock 'parity')) { return }
    $code = Invoke-Logged -Name 'parity' -File 'node' -WorkDir $Terminal -Arguments @('desktop/harness/run.mjs', '--mode', 'parity')
    Add-Result 'parity' ($code -eq 0) "exit $code, log $LogDir\parity.log"
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
    Step-PreflightSelfTest
    Step-OrderScan
}

# ---- Serialised with the backend tests: the PYTEST lock of a pytest session ----
$PytestLockStaleHours = 2

function Get-PytestLocks {
    # The PYTEST.<pid>.lock files in $Dir: Fresh were written within the stale window, Stale were not (a session that died).
    # A lock is also stale at once when the process named in PYTEST.<pid>.lock is gone (a session killed without its cleanup);
    # the two-hour age limit stays as the fallback for a reused pid.
    param([string]$Dir, [datetime]$Now = (Get-Date))
    $all = @()
    if (Test-Path -LiteralPath $Dir) {
        $all = @(Get-ChildItem -LiteralPath $Dir -Filter 'PYTEST.*.lock' -File -ErrorAction SilentlyContinue)
    }
    $fresh = @()
    $stale = @()
    foreach ($lock in $all) {
        $why = $null
        if (($Now - $lock.LastWriteTime).TotalHours -ge $PytestLockStaleHours) {
            $why = ('last written {0:u}, older than {1} h' -f $lock.LastWriteTime, $PytestLockStaleHours)
        } elseif ($lock.Name -match '^PYTEST\.(\d+)\.lock$' -and -not (Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue)) {
            $why = ('process {0} is not running' -f $Matches[1])
        }
        if ($why) {
            $stale += $lock | Add-Member -NotePropertyName Why -NotePropertyValue $why -PassThru -Force
        } else {
            $fresh += $lock
        }
    }
    return [pscustomobject]@{ Fresh = @($fresh); Stale = @($stale) }
}

function Wait-NoPytestLock {
    # Polls while a fresh PYTEST lock exists, saying so each time; true when the way is clear, false after the timeout.
    param([string]$Step)
    $started = Get-Date
    $deadline = $started.AddSeconds($PytestWaitTimeoutSeconds)
    $waited = $false
    $names = ''
    while ($true) {
        $locks = Get-PytestLocks -Dir $PytestLockDir
        foreach ($stale in $locks.Stale) {
            Write-Host ("NOTE  pytest-lock  ignoring stale lock {0} ({1})" -f $stale.Name, $stale.Why)
        }
        if ($locks.Fresh.Count -eq 0) { break }
        $names = ($locks.Fresh | ForEach-Object { $_.Name }) -join ', '
        if ((Get-Date) -ge $deadline) {
            Add-Result "pytest-wait-$Step" $false "PYTEST lock still held after $PytestWaitTimeoutSeconds s ($names); the step was not run"
            return $false
        }
        $waited = $true
        Write-Host ("WAIT  {0}  a backend pytest session holds {1} in {2}; next look in {3} s" -f $Step, $names, $PytestLockDir, $PytestWaitPollSeconds)
        Start-Sleep -Seconds $PytestWaitPollSeconds
    }
    if ($waited) {
        Add-Result "pytest-wait-$Step" $true ("waited {0} s for {1}" -f [int]((Get-Date) - $started).TotalSeconds, $names)
    }
    return $true
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
    $code = Invoke-Logged -Name $Name -File 'corepack' -WorkDir $web -Arguments @('pnpm', '--dir', $web, $Script)
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

# ---- Preflight (AUD-3): fail fast, with a clear message, before anything is built ----
$CheckLockName = 'check.lock'

function Test-IsIoError {
    # .NET calls reach PowerShell wrapped in a MethodInvocationException, so the type is read off the base exception.
    param($ErrorRecord)
    return $ErrorRecord.Exception.GetBaseException() -is [System.IO.IOException]
}

function Get-NewestWebSource {
    # The newest file under web\src that is part of the build: test and spec files are not.
    param([string]$Web)
    $src = Join-Path $Web 'src'
    if (-not (Test-Path -LiteralPath $src)) { return $null }
    return Get-ChildItem -LiteralPath $src -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '\.(test|spec)\.[^.]+$' } |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
}

function Get-DistProblem {
    # $null when web\dist\index.html exists and is not older than the newest build source, else the message.
    param([string]$Web)
    $index = Join-Path $Web 'dist\index.html'
    if (-not (Test-Path -LiteralPath $index)) {
        return "web\dist is missing ($index): build the web first with 'pnpm --dir web build'"
    }
    $built = (Get-Item -LiteralPath $index).LastWriteTimeUtc
    $newest = Get-NewestWebSource $Web
    if ($null -ne $newest -and $newest.LastWriteTimeUtc -gt $built) {
        return ("web\dist is stale: {0} changed at {1:u}, after dist was built at {2:u}; run 'pnpm --dir web build' (a stale dist shows up later as 'HOME never became ready')" -f $newest.FullName, $newest.LastWriteTimeUtc, $built)
    }
    return $null
}

function Get-CargoLockProblem {
    # Cargo holds <target>\<profile>\.cargo-lock open while it builds; a lock file that cannot be opened exclusively is a build in progress.
    param([string]$Target)
    if (-not (Test-Path -LiteralPath $Target)) { return $null }
    $locks = @(Get-ChildItem -LiteralPath $Target -Filter '.cargo-lock' -Recurse -Depth 2 -Force -File -ErrorAction SilentlyContinue)
    foreach ($lock in $locks) {
        try {
            $held = [System.IO.File]::Open($lock.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            $held.Dispose()
        } catch {
            if (Test-IsIoError $_) { return "a cargo build is running: $($lock.FullName) is locked (another build is using this target folder); wait for it to end" }
        }
    }
    return $null
}

function Test-WebBuildCommandLine {
    # True for a node, pnpm or corepack command line that runs `build` on this web folder.
    param([string]$CommandLine, [string]$Web)
    if ([string]::IsNullOrEmpty($CommandLine)) { return $false }
    if ($CommandLine.IndexOf($Web, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    return ($CommandLine -match 'pnpm|vite') -and ($CommandLine -match '(^|\s|")build(\s|"|$)')
}

function Get-WebBuildProblem {
    # $Processes (objects with ProcessId, Name, CommandLine) is the live process list unless a test passes its own.
    param([string]$Web, [object[]]$Processes = $null)
    if ($null -eq $Processes) { $Processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID }) }
    foreach ($p in $Processes) {
        if ($p.Name -match '^(node|pnpm|corepack)(\.exe)?$' -and (Test-WebBuildCommandLine $p.CommandLine $Web)) {
            return "a web build of $Web is running (pid $($p.ProcessId)); wait for it to end, then run check.ps1 again"
        }
    }
    return $null
}

function Get-PreflightProblems {
    param([string]$Web, [string]$Target, [bool]$CheckDist = $true)
    $found = @()
    if ($CheckDist) { $found += Get-DistProblem $Web; $found += Get-WebBuildProblem $Web }
    $found += Get-CargoLockProblem $Target
    return @($found | Where-Object { $_ })
}

function Enter-CheckLock {
    # target\check.lock is held open (shared for reading only) for the whole run: a second run cannot open it for writing, and the
    # operating system drops the hold if this process dies, so a leftover file never blocks anyone.
    param([string]$Target)
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    $path = Join-Path $Target $CheckLockName
    try {
        $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read)
    } catch {
        if (-not (Test-IsIoError $_)) { throw }
        $who = 'holder unknown'
        try {
            $reader = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try { $who = (New-Object System.IO.StreamReader($reader)).ReadToEnd().Trim() } finally { $reader.Dispose() }
        } catch { $who = 'holder unknown' }
        return [pscustomobject]@{ Stream = $null; Path = $path; Problem = "another check.ps1 run is using this target folder ($who); wait for it to end" }
    }
    $bytes = [System.Text.Encoding]::ASCII.GetBytes(("pid {0}, started {1:u}" -f $PID, (Get-Date)))
    $stream.SetLength(0)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    return [pscustomobject]@{ Stream = $stream; Path = $path; Problem = $null }
}

function Exit-CheckLock {
    param($Lock)
    if ($null -eq $Lock -or $null -eq $Lock.Stream) { return }
    $Lock.Stream.Dispose()
    Remove-Item -LiteralPath $Lock.Path -Force -ErrorAction SilentlyContinue
}

function Invoke-PreflightSelfTest {
    # Born failing: every case plants the broken state and must be caught, and the matching good state must pass.
    $root = Join-Path 'D:\dev\tmp' ("check-preflight-self-{0}-{1}" -f $PID, (Get-Date -Format 'HHmmssfff'))
    $held = New-Object System.Collections.Generic.List[object]
    function Add-Case([string]$Name, [bool]$Ok, [string]$Detail) { Add-Result $Name $Ok $Detail; if (-not $Ok) { $script:selfFailed = $true } }
    $script:selfFailed = $false
    function New-WebTree([string]$Name, [int]$DistAgeSeconds, [int]$SrcAgeSeconds, [hashtable]$ExtraSrc = @{}) {
        $web = Join-Path $root "$Name\web"
        New-Item -ItemType Directory -Force -Path (Join-Path $web 'src'), (Join-Path $web 'dist') | Out-Null
        $files = @{ 'src\App.tsx' = $SrcAgeSeconds; 'dist\index.html' = $DistAgeSeconds }
        foreach ($k in $ExtraSrc.Keys) { $files["src\$k"] = $ExtraSrc[$k] }
        foreach ($rel in $files.Keys) {
            $file = Join-Path $web $rel
            Set-Content -LiteralPath $file -Value 'x'
            (Get-Item -LiteralPath $file).LastWriteTime = (Get-Date).AddSeconds(-$files[$rel])
        }
        return $web
    }
    try {
        $stale = Get-DistProblem (New-WebTree 'stale' 3600 60)
        Add-Case 'stale-dist' ($stale -match 'stale' -and $stale -match 'App\.tsx' -and $stale -match 'pnpm') "$stale"
        $missingWeb = New-WebTree 'missing' 600 3600
        Remove-Item -LiteralPath (Join-Path $missingWeb 'dist') -Recurse -Force
        $missing = Get-DistProblem $missingWeb
        Add-Case 'missing-dist' ($missing -match 'missing') "$missing"
        $fresh = Get-DistProblem (New-WebTree 'fresh' 600 3600)
        Add-Case 'fresh-dist' ($null -eq $fresh) "problem: $fresh"
        $tests = Get-DistProblem (New-WebTree 'tests' 3600 7200 @{ 'App.test.tsx' = 30; 'x.spec.ts' = 30 })
        Add-Case 'test-files-ignored' ($null -eq $tests) "problem: $tests"

        $target = Join-Path $root 'target'
        $lockFile = Join-Path $target 'debug\.cargo-lock'
        New-Item -ItemType Directory -Force -Path (Split-Path $lockFile) | Out-Null
        Set-Content -LiteralPath $lockFile -Value ''
        $free = Get-CargoLockProblem $target
        $cargoHold = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $held.Add($cargoHold)
        $busy = Get-CargoLockProblem $target
        $cargoHold.Dispose()
        $held.Remove($cargoHold) | Out-Null
        $after = Get-CargoLockProblem $target
        Add-Case 'cargo-lock-held' (($null -eq $free) -and ($busy -match 'cargo') -and ($null -eq $after)) "free: $free; held: $busy; released: $after"

        $first = Enter-CheckLock (Join-Path $root 'locktarget')
        $held.Add($first.Stream)
        $second = Enter-CheckLock (Join-Path $root 'locktarget')
        Exit-CheckLock $first
        $held.Remove($first.Stream) | Out-Null
        $third = Enter-CheckLock (Join-Path $root 'locktarget')
        $thirdOk = ($null -eq $third.Problem) -and ($null -ne $third.Stream)
        Exit-CheckLock $third
        Add-Case 'check-lock-held' (($null -eq $first.Problem) -and ($second.Problem -match 'another check\.ps1') -and ($second.Problem -match 'pid \d+') -and $thirdOk) "second: $($second.Problem)"

        $web = 'D:\lab\terminal\web'
        $build = [pscustomobject]@{ ProcessId = 4242; Name = 'node.exe'; CommandLine = "node C:\x\pnpm.cjs --dir $web build" }
        $vite = [pscustomobject]@{ ProcessId = 4243; Name = 'node.exe'; CommandLine = "node $web\node_modules\vite\bin\vite.js build" }
        $other = @(
            [pscustomobject]@{ ProcessId = 1; Name = 'node.exe'; CommandLine = "node C:\x\pnpm.cjs --dir $web test" },
            [pscustomobject]@{ ProcessId = 2; Name = 'node.exe'; CommandLine = 'node C:\x\pnpm.cjs --dir D:\other\web build' },
            [pscustomobject]@{ ProcessId = 3; Name = 'powershell.exe'; CommandLine = "powershell -Command pnpm --dir $web build; check.ps1" })
        $hitBuild = Get-WebBuildProblem $web @($build)
        $hitVite = Get-WebBuildProblem $web @($vite)
        $spared = Get-WebBuildProblem $web $other
        Add-Case 'web-build-running' (($hitBuild -match '4242') -and ($hitVite -match '4243') -and ($null -eq $spared)) "pnpm: $hitBuild; vite: $hitVite; others: $spared"
    } catch {
        Add-Case 'preflight-selftest-error' $false $_.Exception.Message
    } finally {
        foreach ($s in $held) { try { $s.Dispose() } catch { } }
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
    return (-not $script:selfFailed)
}

function Step-PreflightSelfTest { [void](Invoke-PreflightSelfTest) }

if ($PreflightSelfTest) {
    $ok = Invoke-PreflightSelfTest
    Write-Host ("check.ps1: preflight self-test, {0} cases, {1} failed" -f $Results.Count, @($Results | Where-Object { -not $_.Passed }).Count)
    if ($ok) { exit 0 } else { exit 1 }
}

if ($PytestWaitOnly) {
    $clear = Wait-NoPytestLock 'wait-only'
    Write-Host ("check.ps1: pytest wait only, {0}" -f $(if ($clear) { 'clear' } else { 'timed out' }))
    if ($clear) { exit 0 } else { exit 4 }
}

$Lock = $null
if (-not $SkipPreflight) {
    $problems = @(Get-PreflightProblems -Web $WebDir -Target $TargetDir -CheckDist (-not $SupplyChainOnly.IsPresent))
    if ($problems.Count -eq 0) {
        $Lock = Enter-CheckLock $TargetDir
        if ($Lock.Problem) { $problems = @($Lock.Problem); $Lock = $null }
    }
    if ($problems.Count -gt 0) {
        foreach ($problem in $problems) { Write-Host "FAIL  preflight  $problem" }
        Write-Host 'check.ps1: preflight failed, no step was run (-SkipPreflight turns the preflight off)'
        exit 3
    }
    Write-Host "preflight ok: web\dist is current, no concurrent build holds $TargetDir"
}
if ($PreflightOnly) {
    if ($PreflightHoldSeconds -gt 0) {
        Write-Host "holding the lock for $PreflightHoldSeconds s"
        Start-Sleep -Seconds $PreflightHoldSeconds
    }
    Exit-CheckLock $Lock
    exit 0
}

try {
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-BuildEnvironment
Set-SeamRequirement | Out-Null
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
if (Wait-NoPytestLock 'test-smoke') { Step-Cargo 'test-smoke' (@('test', '--locked') + $smoke) }
Step-PeInfoOfBuild 'pe-info-smoke-debug' $smoke
if (Wait-NoPytestLock 'test-measure') { Step-Cargo 'test-measure' (@('test', '--locked') + $measure) }
Step-PeInfoOfBuild 'pe-info-measure-debug' $measure
if ($ShowProof) { Step-ShowProof 'smoke'; Step-ShowProof 'measure' }
Invoke-SupplyChainSteps
Step-Node 'look-css' @((Join-Path $PSScriptRoot 'copy-tokens.mjs'), '--check')
Step-Scope
if (-not $SkipSmokeRelease) { Step-SmokeRelease }
Step-ManifestWarnings
Step-NoBuildFolders
Step-Parity
if (-not $ShowProof) { Write-Host 'NOTE  show-proof  not run: pass -ShowProof (needs screen 2) for the born-failing no-show proof' }
}
if ($Web) { Invoke-WebSteps }
} finally {
    Exit-CheckLock $Lock
}

$failed = @($Results | Where-Object { -not $_.Passed })
$cAfter = [math]::Round((Get-PSDrive C).Free / 1MB)
Write-Host ''
Write-Host ("check.ps1: {0} steps, {1} failed; C: free {2} MB before, {3} MB after" -f $Results.Count, $failed.Count, $cDrive, $cAfter)
$Results | ConvertTo-Json | Set-Content -Path (Join-Path $LogDir 'summary.json') -Encoding utf8
if ($failed.Count -gt 0) { exit 1 }
exit 0
