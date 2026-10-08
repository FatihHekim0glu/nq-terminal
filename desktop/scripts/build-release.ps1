# The local release build (04 D5.4, 03 section 13.1; the Windows stand-in for desktop-release.yml): four builds from
# one tree, with the checks the roadmap names, into one folder with its checksums and provenance.
#
#   powershell -NoProfile -File desktop\scripts\build-release.ps1 -Version 0.3.3 [-TargetDir D:\dev\targets\release] [-Force]
#
# Builds, all with cargo-tauri on the GNU host and --locked:
#   release  cargo tauri build --bundles nsis -- --locked                                  (no smoke, no measure)
#   measure  cargo tauri build --bundles nsis --features measure --config src-tauri\tauri.measure.conf.json
#                -- --locked --no-default-features
#   installtest  cargo tauri build --bundles nsis --config src-tauri\tauri.installtest.conf.json -- --locked
#                the release feature set under the product name "nq-lab terminal installtest" and its own identifier, so that
#                install-test.ps1 can install and upgrade it on a PC that already has the real app (never the real product)
#   smoke    cargo tauri build --no-bundle --features smoke --config src-tauri\tauri.smoke.conf.json
#                -- --locked --no-default-features
# The four builds share one target folder, so each build's outputs are copied out straight after it (the next
# build overwrites target\release\nq-lab-terminal.exe).
#
# Output, D:\dev\release\<version>\ (or -OutRoot):
#   <product>_<version>_x64-setup.exe          the release installer
#   <product> measure_<version>_x64-setup.exe  the measure installer
#   <product> installtest_<version>_x64-setup.exe  the install-test installer (never published)
#   payload\release|measure|installtest|smoke\             the exe each build produced, with WebView2Loader.dll
#   nsis\release|measure|installtest\installer.nsi         the generated installer script (install-test.ps1 reads it)
#   nsis\release|measure|installtest\hooks.nsh              the installer hooks it includes (artefact-check.mjs reads them)
#   config\tauri*.conf.json                    the configuration files the builds used (artefact-check.mjs reads them)
#   SHA256SUMS                                 sha256 of every file above, sha256sum style
#   PROVENANCE.json                            version, HEAD, sha256 of `git diff HEAD`, sha256 of the untracked
#                                              files (the stamp of scripts\record_green.ps1 -Stamp), tools, sizes
#
# Checks, each failing the script: Cargo.lock holds no updater plugin; the version in tauri.conf.json and
# Cargo.toml equals -Version; `cargo tree -e features` of the release feature set names no smoke or measure feature
# and no tauri devtools feature; the measure and smoke trees name only their own feature; no build log shows the
# manifest merge warning; the provenance stamp is the same before and after (the tree did not change while
# building); the WebView2 bootstrapper the installers embed (the bundler downloads it unchecked and reuses a cached file)
# is validly signed by Microsoft Corporation before the builds, in the release installer script after the release build
# and in the measure one after the measure build, is the same file each time, and is recorded in PROVENANCE.json
# (webview2_bootstrapper); the installer is under the 30 MB ceiling (a note above 15 MB). It prints every size.
#
# Build-machine paths: Rust panic locations and debug info carry source paths (the earlier release exes held
# D:\dev\cargo\registry\...). Every build of this script runs with CARGO_ENCODED_RUSTFLAGS holding rustc
# --remap-path-prefix flags that map D:\dev, the user profile, the cargo home, the rustup home, the source folder (terminal\) and
# the target folder to neutral prefixes (/dev, /home/user, /cargo, /rustup, /src, /target); flags already in the environment
# are kept, and there is no rustflags setting in src-tauri\.cargo\config.toml to replace. Afterwards artefact-check.mjs --paths
# fails the build if any D:\dev or C:\Users path (either slash direction) is still in an exe, a dll or an installer, and
# artefact-check.mjs runs the same scan over the whole folder.
#
# Toolchain, caches and output stay under D:\dev; the owner's PATH is not changed; nothing is written under the tree.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [string]$TargetDir = 'D:\dev\targets\release',
    [string]$OutRoot = 'D:\dev\release',
    [string]$LogRoot = 'D:\dev\tmp\build-release',
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Desktop = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Crate = Join-Path $Desktop 'src-tauri'
$Terminal = (Resolve-Path (Join-Path $Desktop '..')).Path
$OutDir = Join-Path $OutRoot $Version
$LogDir = Join-Path $LogRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$InstallerCeilingMb = 30
$InstallerNoteMb = 15
$BuildRoot = 'D:\dev'
$ManifestWarning = 'multiple non-default manifests|\.rsrc merge failure'
$Failures = New-Object System.Collections.Generic.List[string]
$BootstrapperCache = Join-Path $env:LOCALAPPDATA 'tauri\MicrosoftEdgeWebview2Setup.exe'
. (Join-Path $PSScriptRoot 'webview2-bootstrapper.ps1')

function Get-RemapFlags {
    # rustc --remap-path-prefix flags that hide the build machine from the binaries (Rust panic locations and debug info carry
    # source paths): the catch-all folders first, then the specific ones, because rustc applies the LAST matching remap.
    # The targets are neutral and name no drive, user or host. Used for every build of this script: release, measure,
    # installtest and smoke.
    $pairs = @(
        @($BuildRoot, '/dev'),
        @($env:USERPROFILE, '/home/user'),
        @($env:CARGO_HOME, '/cargo'),
        @($env:RUSTUP_HOME, '/rustup'),
        @($Terminal, '/src'),
        @($TargetDir, '/target')
    )
    foreach ($pair in $pairs) {
        if ($pair[0]) { "--remap-path-prefix=$($pair[0].TrimEnd('\'))=$($pair[1])" }
    }
}

function Get-BuildRustFlags {
    # The rust flags already in the environment (CARGO_ENCODED_RUSTFLAGS wins over RUSTFLAGS, as cargo reads them; none today),
    # then the remaps, so a flag set elsewhere is kept rather than replaced.
    $existing = @()
    if ($env:CARGO_ENCODED_RUSTFLAGS) { $existing = @($env:CARGO_ENCODED_RUSTFLAGS -split [char]0x1f | Where-Object { $_ }) }
    elseif ($env:RUSTFLAGS) { $existing = @($env:RUSTFLAGS -split '\s+' | Where-Object { $_ }) }
    return @($existing) + @(Get-RemapFlags)
}

function Set-BuildEnvironment {
    $env:RUSTUP_HOME = 'D:\dev\rustup'
    $env:CARGO_HOME = 'D:\dev\cargo'
    $env:PATH = "D:\dev\cargo\bin;D:\dev\mingw\mingw64\bin;$env:PATH"
    $env:TEMP = 'D:\dev\tmp'
    $env:TMP = 'D:\dev\tmp'
    $env:CARGO_TARGET_DIR = $TargetDir
    # The encoded form joins the flags by the unit separator, so the source folder may contain a space (a user name does).
    $flags = Get-BuildRustFlags
    Remove-Item env:RUSTFLAGS -ErrorAction SilentlyContinue
    $env:CARGO_ENCODED_RUSTFLAGS = $flags -join [string][char]0x1f
    if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '8' }
    Get-ChildItem env: | Where-Object { $_.Name -like 'WEBVIEW2_*' } | ForEach-Object { Remove-Item "env:$($_.Name)" }
}

function Add-Failure {
    param([string]$Message)
    $Failures.Add($Message)
    Write-Host "FAIL  $Message"
}

function Invoke-Logged {
    # A native command with its output in a log file; returns the exit code.
    param([string]$Name, [string]$File, [string[]]$Arguments, [string]$WorkDir)
    $log = Join-Path $LogDir "$Name.log"
    Push-Location $WorkDir
    try {
        $ErrorActionPreference = 'Continue'
        & $File @Arguments *> $log
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
    } finally { Pop-Location }
    return $code
}

function Get-Stamp {
    $text = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Terminal 'scripts\record_green.ps1') -Stamp
    if ($LASTEXITCODE -ne 0) { throw 'record_green.ps1 -Stamp failed' }
    return ($text -join "`n") | ConvertFrom-Json
}

function Get-TreeText {
    # `cargo tree -e features` of one feature set, as text. -i makes cargo print the features of that one package
    # (the plain tree never lists the root package's own features, so a grep of it for smoke could not fail).
    param([string[]]$FeatureArguments, [string]$Name, [string]$Invert)
    $code = Invoke-Logged -Name "tree-$Name" -File 'cargo' -Arguments (@('tree', '-e', 'features', '--locked', '-i', $Invert) + $FeatureArguments) -WorkDir $Crate
    if ($code -ne 0) { throw "cargo tree for $Name failed (exit $code)" }
    return Get-Content -Raw -Path (Join-Path $LogDir "tree-$Name.log")
}

function Test-FeatureSet {
    # The root package's features must be exactly the set's own; tauri must not carry devtools.
    param([string]$Name, [string[]]$FeatureArguments, [string]$Forbidden, [string]$Required)
    $root = Get-TreeText $FeatureArguments "$Name-root" 'nq-lab-terminal'
    $tauri = Get-TreeText $FeatureArguments "$Name-tauri" 'tauri'
    if ($root -match $Forbidden) { Add-Failure "the $Name feature set carries a forbidden feature ($Forbidden): see tree-$Name-root.log" }
    if ($Required -and $root -notmatch "feature `"$Required`"") { Add-Failure "the $Name feature set lacks its own feature $Required" }
    if ($tauri -match 'feature "devtools"') { Add-Failure "the $Name feature set enables tauri devtools" }
    $names = @([regex]::Matches($root, 'feature "([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    Write-Host "feature set ${Name}: root features [$($names -join ', ')]"
}

function Test-FeatureTrees {
    Test-FeatureSet 'release' @() 'feature "(smoke|measure)"' ''
    Test-FeatureSet 'measure' @('--no-default-features', '--features', 'measure') 'feature "smoke"' 'measure'
    Test-FeatureSet 'smoke' @('--no-default-features', '--features', 'smoke') 'feature "measure"' 'smoke'
    $full = Invoke-Logged -Name 'tree-release-full' -File 'cargo' -Arguments @('tree', '-e', 'features', '--locked') -WorkDir $Crate
    if ($full -ne 0) { Add-Failure "cargo tree -e features (the plan's own command) failed ($full)" }
    elseif ((Select-String -Path (Join-Path $LogDir 'tree-release-full.log') -Pattern 'smoke|measure')) { Add-Failure 'the full release tree names smoke or measure (tree-release-full.log)' }
}

function Test-Sources {
    $lock = Get-Content -Raw -Path (Join-Path $Crate 'Cargo.lock')
    if ($lock -match 'name = "tauri-plugin-updater"') { Add-Failure 'Cargo.lock holds tauri-plugin-updater (no updater, 03 section 14)' }
    $conf = Get-Content -Raw -Path (Join-Path $Crate 'tauri.conf.json') | ConvertFrom-Json
    if ($conf.version -ne $Version) { Add-Failure "tauri.conf.json version is $($conf.version), not $Version" }
    $cargo = (Select-String -Path (Join-Path $Crate 'Cargo.toml') -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
    if ($cargo -ne $Version) { Add-Failure "Cargo.toml version is $cargo, not $Version" }
    if ($conf.bundle.createUpdaterArtifacts -ne $false) { Add-Failure 'bundle.createUpdaterArtifacts is not false' }
    if ($null -ne $conf.PSObject.Properties['plugins'] -and $null -ne $conf.plugins.PSObject.Properties['updater']) { Add-Failure 'tauri.conf.json has plugins.updater' }
}

function Invoke-Build {
    # One cargo-tauri build, then the copy of its outputs into $OutDir.
    param([string]$Name, [string[]]$Arguments)
    Write-Host "build $Name ..."
    $code = Invoke-Logged -Name "build-$Name" -File 'cargo' -Arguments (@('tauri', 'build') + $Arguments) -WorkDir $Desktop
    if ($code -ne 0) { Add-Failure "the $Name build failed (exit $code), log $LogDir\build-$Name.log"; return $false }
    return $true
}

function Test-MachinePaths {
    # The built binaries hold no D:\dev or C:\Users path (either slash direction): artefact-check.mjs --paths, the scan the
    # release folder gets again as a whole. The remap flags of Set-BuildEnvironment are what keep them out.
    param([string]$Name, [string[]]$Files)
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Add-Failure "node is not on PATH, so the $Name binaries cannot be scanned for build-machine paths"; return }
    $existing = @($Files | Where-Object { Test-Path -LiteralPath $_ })
    if ($existing.Count -eq 0) { return }
    $ErrorActionPreference = 'Continue'
    $text = & $node.Source (Join-Path $PSScriptRoot 'artefact-check.mjs') '--paths' @existing 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -ne 0) { Add-Failure "the $Name binaries hold build-machine paths (D:\dev or C:\Users): $($text.Trim())" }
    else { Write-Host "paths ($Name): $($text.Trim())" }
}

function Copy-Payload {
    param([string]$Name, [switch]$WithInstaller)
    $release = Join-Path $TargetDir 'release'
    $dest = Join-Path $OutDir "payload\$Name"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    foreach ($file in 'nq-lab-terminal.exe', 'WebView2Loader.dll') {
        $source = Join-Path $release $file
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $dest } else { Add-Failure "the $Name build left no $file in $release" }
    }
    Test-MachinePaths $Name @((Join-Path $dest 'nq-lab-terminal.exe'), (Join-Path $dest 'WebView2Loader.dll'))
    if (-not $WithInstaller) { return }
    $installers = @(Get-ChildItem (Join-Path $release 'bundle\nsis') -Filter "*_${Version}_x64-setup.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt $script:BuildStart })
    if ($installers.Count -ne 1) { Add-Failure "the $Name build left $($installers.Count) fresh installers, expected 1"; return }
    Copy-Item -LiteralPath $installers[0].FullName -Destination $OutDir
    Test-MachinePaths "$Name installer" @((Join-Path $OutDir $installers[0].Name))
    $nsiDest = Join-Path $OutDir "nsis\$Name"
    New-Item -ItemType Directory -Force -Path $nsiDest | Out-Null
    Copy-Item -LiteralPath (Join-Path $release 'nsis\x64\installer.nsi') -Destination $nsiDest
    # The installer hooks the script includes, kept beside it so the artefact check reads the file that was compiled in.
    Copy-Item -LiteralPath (Join-Path $Crate 'windows\nsis\hooks.nsh') -Destination $nsiDest
    $script:Installers[$Name] = $installers[0].Name
}

function Copy-Config {
    # Tauri 2 compiles its configuration into the exe as Rust data, so artefact-check.mjs reads the files the builds used.
    $dest = Join-Path $OutDir 'config'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    foreach ($name in 'tauri.conf.json', 'tauri.measure.conf.json', 'tauri.smoke.conf.json', 'tauri.installtest.conf.json') { Copy-Item -LiteralPath (Join-Path $Crate $name) -Destination $dest }
}

function Test-Bootstrapper {
    # The bootstrapper file an installer script embeds: a valid Microsoft Corporation signature, and the same file
    # (path and sha256) as the one checked before the builds and in the release script. Returns the record.
    param([string]$Name, $Expected)
    $nsi = Join-Path $OutDir "nsis\$Name\installer.nsi"
    $path = if (Test-Path -LiteralPath $nsi) { Get-BootstrapperPath $nsi } else { $null }
    if (-not $path) { Add-Failure "the $Name installer script names no WebView2 bootstrapper (nsis\$Name\installer.nsi)"; return $null }
    $record = Get-BootstrapperRecord $path
    Write-Host "bootstrapper ($Name): $($record.path), sha256 $($record.sha256), signature $($record.signature_status), signer $($record.signer)"
    if (-not $record.valid) { Add-Failure "the WebView2 bootstrapper of the $Name installer is not validly signed by Microsoft Corporation (signature $($record.signature_status), signer $($record.signer))" }
    if ($null -ne $Expected -and (($record.sha256 -ne $Expected.sha256) -or ($record.path -ne $Expected.path))) {
        Add-Failure "the WebView2 bootstrapper of the $Name installer ($($record.path), $($record.sha256)) is not the one checked earlier ($($Expected.path), $($Expected.sha256))"
    }
    return $record
}

function Test-BootstrapperCache {
    # Before the builds: a file already in the bundler's cache is reused as it is, so it is checked first (none yet:
    # the bundler downloads it, and the release installer script is checked after the build).
    if (-not (Test-Path -LiteralPath $BootstrapperCache)) { Write-Host "bootstrapper cache: none yet at $BootstrapperCache"; return $null }
    $record = Get-BootstrapperRecord $BootstrapperCache
    Write-Host "bootstrapper cache: sha256 $($record.sha256), signature $($record.signature_status), signer $($record.signer)"
    if (-not $record.valid) { Add-Failure "the cached WebView2 bootstrapper $BootstrapperCache is not validly signed by Microsoft Corporation (signature $($record.signature_status))" }
    return $record
}

function Test-ManifestWarnings {
    $hits = Get-ChildItem $LogDir -Filter 'build-*.log' | Select-String -Pattern $ManifestWarning
    if ($null -ne $hits) { Add-Failure "a build log shows the manifest merge warning ($(@($hits).Count) hits)" }
}

function Get-FileRecords {
    param([switch]$KeepProvenance)
    $skip = @('SHA256SUMS')
    if (-not $KeepProvenance) { $skip += 'PROVENANCE.json' }
    $files = Get-ChildItem $OutDir -Recurse -File | Where-Object { $skip -notcontains $_.Name -or $_.DirectoryName -ne $OutDir } | Sort-Object FullName
    $prefix = $OutDir.TrimEnd('\') + '\'
    return @($files | ForEach-Object {
        $relative = $_.FullName.Substring($prefix.Length).Replace('\', '/')
        [pscustomobject]@{ path = $relative; size = $_.Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
    })
}

function Write-Checksums {
    # Every file of the folder but SHA256SUMS itself, PROVENANCE.json included (so it cannot change unseen).
    $all = Get-FileRecords -KeepProvenance
    $lines = @($all | Sort-Object { $_.path } | ForEach-Object { "$($_.sha256) *$($_.path)" })
    [System.IO.File]::WriteAllText((Join-Path $OutDir 'SHA256SUMS'), (($lines -join "`n") + "`n"), $Utf8)
}

function Write-Provenance {
    param($StampValue, $Records)
    $tools = [ordered]@{
        rustc = (& rustc -V) -join ' '
        cargo = (& cargo -V) -join ' '
        cargo_tauri = (& cargo tauri --version) -join ' '
    }
    $doc = [ordered]@{
        version = $Version
        built_utc = (Get-Date).ToUniversalTime().ToString('o')
        pc = $env:COMPUTERNAME
        head = $StampValue.head
        diff_sha256 = $StampValue.diff_sha256
        untracked_sha256 = $StampValue.untracked_sha256
        untracked_count = $StampValue.untracked_count
        target_dir = $TargetDir
        tools = $tools
        installers = $script:Installers
        webview2_bootstrapper = $script:Bootstrapper
        files = $Records
    }
    [System.IO.File]::WriteAllText((Join-Path $OutDir 'PROVENANCE.json'), (($doc | ConvertTo-Json -Depth 6) + "`n"), $Utf8)
}

function Write-Sizes {
    param($Records)
    Write-Host ''
    foreach ($r in $Records) { Write-Host ("{0,12:N0} bytes  {1}" -f $r.size, $r.path) }
    foreach ($name in $script:Installers.Keys) {
        $mb = (Get-Item -LiteralPath (Join-Path $OutDir $script:Installers[$name])).Length / 1MB
        if ($mb -gt $InstallerCeilingMb) { Add-Failure ("the $name installer is {0:N1} MB, over the $InstallerCeilingMb MB ceiling" -f $mb) }
        elseif ($mb -gt $InstallerNoteMb) { Write-Host ("NOTE  the $name installer is {0:N1} MB, over the $InstallerNoteMb MB estimate" -f $mb) }
    }
}

function Initialize-OutDir {
    if ((Test-Path -LiteralPath $OutDir) -and @(Get-ChildItem -LiteralPath $OutDir -Force).Count -gt 0) {
        if (-not $Force) { throw "$OutDir is not empty; pass -Force to rebuild into it" }
        $full = (Resolve-Path -LiteralPath $OutDir).Path
        if (-not $full.StartsWith($OutRoot.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw "refusing to clear $full" }
        Get-ChildItem -LiteralPath $full -Force | Remove-Item -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-BuildEnvironment
$script:Installers = @{}
$script:Bootstrapper = $null
$script:BuildStart = Get-Date
$cBefore = [math]::Round((Get-PSDrive C).Free / 1MB)
Write-Host "build-release: version $Version, tree $Terminal, target $TargetDir, out $OutDir, logs $LogDir, C: free $cBefore MB"

Test-Sources
if ($Failures.Count -gt 0) { exit 1 }
$stampBefore = Get-Stamp
Initialize-OutDir
Test-FeatureTrees
$cacheBefore = Test-BootstrapperCache

$script:BuildStart = Get-Date
if (Invoke-Build 'release' @('--bundles', 'nsis', '--', '--locked')) { Copy-Payload 'release' -WithInstaller; $script:Bootstrapper = Test-Bootstrapper 'release' $cacheBefore }
$script:BuildStart = Get-Date
if (Invoke-Build 'measure' @('--bundles', 'nsis', '--features', 'measure', '--config', 'src-tauri\tauri.measure.conf.json', '--', '--locked', '--no-default-features')) { Copy-Payload 'measure' -WithInstaller; Test-Bootstrapper 'measure' $script:Bootstrapper | Out-Null }
$script:BuildStart = Get-Date
if (Invoke-Build 'installtest' @('--bundles', 'nsis', '--config', 'src-tauri\tauri.installtest.conf.json', '--', '--locked')) { Copy-Payload 'installtest' -WithInstaller; Test-Bootstrapper 'installtest' $script:Bootstrapper | Out-Null }
if (Invoke-Build 'smoke' @('--no-bundle', '--features', 'smoke', '--config', 'src-tauri\tauri.smoke.conf.json', '--', '--locked', '--no-default-features')) { Copy-Payload 'smoke' }
Test-ManifestWarnings
Copy-Config

$stampAfter = Get-Stamp
if (($stampBefore.head -ne $stampAfter.head) -or ($stampBefore.diff_sha256 -ne $stampAfter.diff_sha256) -or ($stampBefore.untracked_sha256 -ne $stampAfter.untracked_sha256)) {
    Add-Failure 'the tree changed while the builds ran (the provenance stamp before and after differ)'
}
$records = Get-FileRecords
Write-Provenance $stampAfter $records
Write-Checksums
Write-Sizes $records

$cAfter = [math]::Round((Get-PSDrive C).Free / 1MB)
Write-Host ''
Write-Host "build-release: $($Failures.Count) failures; C: free $cBefore MB before, $cAfter MB after; stamp head $($stampAfter.head)"
if ($Failures.Count -gt 0) { exit 1 }
Write-Host "next: node $PSScriptRoot\artefact-check.mjs $OutDir"
exit 0
