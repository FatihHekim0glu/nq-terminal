# Born-failing proof of the shell's static bans (03 section 6 item 2; 04 D4.1).
#
#   powershell -NoProfile -File desktop\scripts\plant-check.ps1             every planted case, then the scope scan
#   powershell -NoProfile -File desktop\scripts\plant-check.ps1 -ScopeOnly  the module scope scan of the real crate
#
# Each case copies the crate to D:\dev\tmp\w4a-plant\<run>\<case>, plants ONE forbidden use and runs Clippy with
# -D warnings. The clean copy must pass; every planted copy must fail, and fail on the expected lint (a copy that
# fails for any other reason does not count). Planted: a TcpStream outside link.rs, std::fs::read outside reads.rs,
# std::fs::write outside writes.rs, a window show() outside the release reveal in window.rs, a
# WebviewWindowBuilder::visible, a WebviewWindow::unminimize and a raw Win32 ShowWindow outside their allowed
# sites, and std::process::Command outside an allowed site. A cargo-deny case bans a crate the graph holds and expects
# `cargo deny check bans` to fail. The scope scan then checks that reads.rs holds no write call, writes.rs no read
# call, that none of the three allow-site modules spawns a process, calls show() or names rfd (and link.rs touches
# no file), that no module but link.rs names a socket type and none but dialogs.rs names rfd, born failing on planted text.
[CmdletBinding()]
param(
    [string]$Root = 'D:\dev\tmp\w4a-plant',
    [string]$TargetDir = 'D:\dev\targets\w4a-plant',
    [switch]$ScopeOnly,
    [string[]]$Only = @()   # run only the clippy cases of these names (after the clean copy), not deny or scope
)

$ErrorActionPreference = 'Stop'
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ })   # -File passes "a,b" as one string
$Crate = (Resolve-Path (Join-Path $PSScriptRoot '..\src-tauri')).Path
$Failures = New-Object System.Collections.Generic.List[string]

# Each planted case: the file it goes into, the Rust it appends, and the text the failing Clippy run must show.
$Cases = @(
    @{ Name = 'tcp'; File = 'src\window.rs'; Expect = 'std::net::TcpStream';
       Code = 'pub fn planted_tcp() -> bool { std::net::TcpStream::connect("127.0.0.1:9").is_ok() }' },
    @{ Name = 'fs-read'; File = 'src\window.rs'; Expect = 'std::fs::read';
       Code = 'pub fn planted_read() -> usize { std::fs::read("planted.bin").map(|b| b.len()).unwrap_or(0) }' },
    @{ Name = 'fs-write'; File = 'src\window.rs'; Expect = 'std::fs::write';
       Code = 'pub fn planted_write() -> bool { std::fs::write("planted.bin", b"x").is_ok() }' },
    @{ Name = 'show'; File = 'src\supervise.rs'; Expect = 'show';
       Code = 'pub fn planted_show(w: &tauri::WebviewWindow) -> bool { w.show().is_ok() }' },
    @{ Name = 'visible'; File = 'src\supervise.rs'; Expect = 'WebviewWindowBuilder::visible';
       Code = 'pub fn planted_visible(app: &tauri::AppHandle) -> bool { tauri::WebviewWindowBuilder::new(app, "planted", tauri::WebviewUrl::App("a".into())).visible(true).build().is_ok() }' },
    @{ Name = 'unminimize'; File = 'src\supervise.rs'; Expect = 'WebviewWindow::unminimize';
       Code = 'pub fn planted_unminimize(w: &tauri::WebviewWindow) -> bool { w.unminimize().is_ok() }' },
    @{ Name = 'show-window'; File = 'src\supervise.rs'; Expect = 'WindowsAndMessaging::ShowWindow';
       Code = 'pub fn planted_show_window(w: &tauri::WebviewWindow) -> bool { match w.hwnd() { Ok(h) => { use windows::Win32::UI::WindowsAndMessaging as wm; /* SAFETY: planted */ unsafe { wm::ShowWindow(h, wm::SW_RESTORE).as_bool() } } Err(_) => false } }' },
    @{ Name = 'command'; File = 'src\keys.rs'; Expect = 'std::process::Command::new';
       Code = 'pub fn planted_command() -> bool { std::process::Command::new("cmd").status().is_ok() }' },
    # A banned call planted INSIDE an allowed module must still fail: the allows sit on single functions, never on
    # the module, so link.rs may not read files, reads.rs may not show a window, writes.rs may not start a process.
    @{ Name = 'link-fs-read'; File = 'src\link.rs'; Expect = 'std::fs::read';
       Code = 'pub fn planted_link_read() -> usize { std::fs::read("planted.bin").map(|b| b.len()).unwrap_or(0) }' },
    @{ Name = 'reads-show'; File = 'src\reads.rs'; Expect = 'show';
       Code = 'pub fn planted_reads_show(w: &tauri::WebviewWindow) -> bool { w.show().is_ok() }' },
    @{ Name = 'writes-command'; File = 'src\writes.rs'; Expect = 'std::process::Command::new';
       Code = 'pub fn planted_writes_command() -> bool { std::process::Command::new("cmd").status().is_ok() }' },
    # Raw Win32 calls reach the same data, socket and process paths as the std ones, so each is banned too.
    @{ Name = 'win-createfile'; File = 'src\window.rs'; Expect = 'FileSystem::CreateFileW';
       Code = 'pub fn planted_createfile() -> bool { use windows::Win32::Storage::FileSystem as F; unsafe { F::CreateFileW(windows::core::w!("planted.bin"), 0, F::FILE_SHARE_NONE, None, F::OPEN_EXISTING, F::FILE_ATTRIBUTE_NORMAL, None).is_ok() } }' },
    @{ Name = 'win-deletefile'; File = 'src\window.rs'; Expect = 'FileSystem::DeleteFileW';
       Code = 'pub fn planted_deletefile() -> bool { unsafe { windows::Win32::Storage::FileSystem::DeleteFileW(windows::core::w!("planted.bin")).is_ok() } }' },
    @{ Name = 'win-connect'; File = 'src\keys.rs'; Expect = 'WinSock::connect';
       Code = 'pub fn planted_connect() -> bool { use windows::Win32::Networking::WinSock as W; unsafe { W::connect(W::SOCKET(0), std::ptr::null(), 0) == 0 } }' },
    @{ Name = 'win-socket'; File = 'src\window.rs'; Expect = 'WinSock::socket';
       Code = 'pub fn planted_socket() -> bool { use windows::Win32::Networking::WinSock as W; unsafe { W::socket(2, W::SOCK_STREAM, 0).is_ok() } }' },
    @{ Name = 'win-createprocess'; File = 'src\window.rs'; Expect = 'Threading::CreateProcessW';
       Code = 'pub fn planted_createprocess() -> bool { use windows::Win32::System::Threading as T; let si = T::STARTUPINFOW::default(); let mut pi = T::PROCESS_INFORMATION::default(); unsafe { T::CreateProcessW(windows::core::w!("cmd.exe"), None, None, None, false, T::PROCESS_CREATION_FLAGS(0), None, windows::core::PCWSTR::null(), &si, &mut pi).is_ok() } }' }
)

# The scope rules: a file, and calls it must never name, whatever its Clippy allows say. The three allow-site
# modules (link.rs, reads.rs, writes.rs) carry their allow on single functions, but Clippy cannot allow one path
# and keep the rest, so those functions lift the whole disallowed lint; what clippy.toml bans beyond each
# module's own job (a process, a show(), a native dialog) is held here instead. A rule applies to the
# files in Only, or to every file but those in Except.
$AllowSiteBans = 'Command::new|process::Command|\.show\(|rfd::'
$Connect = '\bconnect(_timeout)?\('
$ScopeRules = @(
    @{ Only = @('reads.rs'); Banned = "fs::write|fs::create_dir|fs::remove_|fs::rename|fs::copy|OpenOptions|File::create|TcpStream|$Connect|$AllowSiteBans" },
    @{ Only = @('writes.rs'); Banned = "fs::read\b|fs::read_to_string|fs::read_dir|File::open|\.read\(true\)|TcpStream|$Connect|$AllowSiteBans" },
    @{ Only = @('link.rs'); Banned = "\bfs::|OpenOptions|File::(open|create)|$AllowSiteBans" },
    @{ Except = @('link.rs'); Banned = 'TcpStream|TcpListener|UdpSocket' },
    # Raw Win32 calls: Clippy bans each path, and a module-level allow lifts the whole lint, so each call is also held
    # to its one module here.
    @{ Except = @('link.rs'); Banned = '\bWSA[A-Z]\w*|WinSock' },
    @{ Except = @('reads.rs', 'writes.rs'); Banned = '\bCreateFile(W|A|2|TransactedW)\b' },
    @{ Except = @('reads.rs'); Banned = '\b(ReadFile|FindFirstFile)\w*' },
    @{ Except = @('writes.rs'); Banned = '\b(WriteFile\w*|DeleteFileW|MoveFile\w*|CopyFile\w*|CreateDirectory\w*|CreateHardLinkW|CreateSymbolicLinkW|RemoveDirectoryW|ReplaceFileW|SetFileAttributesW)\b' },
    @{ Except = @('supervise.rs'); Banned = '\bCreateProcess\w*' },
    @{ Except = @('dialogs.rs'); Banned = 'rfd::' }
)

function Set-BuildEnvironment {
    $env:RUSTUP_HOME = 'D:\dev\rustup'
    $env:CARGO_HOME = 'D:\dev\cargo'
    $env:PATH = "D:\dev\cargo\bin;D:\dev\mingw\mingw64\bin;$env:PATH"
    $env:TEMP = 'D:\dev\tmp'
    $env:TMP = 'D:\dev\tmp'
    $env:CARGO_TARGET_DIR = $TargetDir
    if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '8' }
}

function Get-ScopeViolations {
    # Lines of the given sources that break a scope rule. $Sources maps a file name to its text.
    param([hashtable]$Sources)
    $found = @()
    foreach ($rule in $ScopeRules) {
        foreach ($name in $Sources.Keys) {
            $applies = if ($rule.Only) { $rule.Only -contains $name } else { $rule.Except -notcontains $name }
            if (-not $applies) { continue }
            # Shipped code only: a module's unit tests (its trailing #[cfg(test)] block) may make fixture files.
            $shipped = ($Sources[$name] -split '(?m)^#\[cfg\(test\)\]')[0]
            $lines = $shipped -split "`n"
            for ($i = 0; $i -lt $lines.Count; $i++) {
                $code = ($lines[$i] -replace '//.*$', '')
                if ($code -match $rule.Banned) { $found += "${name}:$($i + 1): $($lines[$i].Trim())" }
            }
        }
    }
    return $found
}

function Test-Scope {
    $sources = @{}
    Get-ChildItem (Join-Path $Crate 'src') -Filter '*.rs' | ForEach-Object { $sources[$_.Name] = [IO.File]::ReadAllText($_.FullName) }
    $real = @(Get-ScopeViolations $sources)
    if ($real.Count -gt 0) { $Failures.Add("scope: $($real -join '; ')") }
    Write-Host ("scope scan of the crate: {0} violations" -f $real.Count)
    # Each planted use must be caught (Hits >= 1) or, for the allowed sites, left alone (Hits = 0).
    $plantedCases = @(
        @{ File = 'reads.rs'; Hits = 1; Text = 'pub fn x() { let _ = std::fs::write(p, b); }' },
        @{ File = 'reads.rs'; Hits = 1; Text = 'pub fn x() { let _ = std::process::Command::new("cmd"); }' },
        @{ File = 'reads.rs'; Hits = 1; Text = 'pub fn x(w: &W) { let _ = w.show(); }' },
        @{ File = 'reads.rs'; Hits = 1; Text = 'pub fn x() { let _ = rfd::FileDialog::new(); }' },
        @{ File = 'writes.rs'; Hits = 1; Text = 'pub fn y() { let _ = std::fs::read(p); }' },
        @{ File = 'writes.rs'; Hits = 1; Text = 'pub fn y() { let _ = std::process::Command::new("cmd"); }' },
        @{ File = 'writes.rs'; Hits = 1; Text = 'pub fn y(w: &W) { let _ = w.show(); }' },
        @{ File = 'writes.rs'; Hits = 1; Text = 'pub fn y() { let _ = rfd::FileDialog::new(); }' },
        @{ File = 'writes.rs'; Hits = 1; Text = 'pub fn y() { let _ = std::fs::File::open(p); }' },
        @{ File = 'writes.rs'; Hits = 1; Text = "pub fn y() { let _ = OpenOptions::new()`n    .read(true)`n    .open(p); }" },
        @{ File = 'writes.rs'; Hits = 1; Text = 'pub fn y() { let _ = connect(a); }' },
        @{ File = 'writes.rs'; Hits = 0; Text = 'pub fn y() { let _ = OpenOptions::new().append(true).create(true).open(p); }' },
        @{ File = 'reads.rs'; Hits = 1; Text = 'pub fn x() { let _ = connect(a); }' },
        @{ File = 'link.rs'; Hits = 1; Text = 'pub fn z() { let _ = std::fs::write(p, b); }' },
        @{ File = 'link.rs'; Hits = 1; Text = 'pub fn z() { let _ = std::fs::read(p); }' },
        @{ File = 'link.rs'; Hits = 1; Text = 'pub fn z() { let _ = std::process::Command::new("cmd"); }' },
        @{ File = 'link.rs'; Hits = 1; Text = 'pub fn z(w: &W) { let _ = w.show(); }' },
        @{ File = 'link.rs'; Hits = 1; Text = 'pub fn z() { let _ = rfd::FileDialog::new(); }' },
        @{ File = 'window.rs'; Hits = 1; Text = 'use std::net::TcpStream;' },
        @{ File = 'window.rs'; Hits = 1; Text = 'pub fn q() { let _ = rfd::FileDialog::new(); }' },
        @{ File = 'link.rs'; Hits = 0; Text = 'use std::net::TcpStream; // allowed here' },
        @{ File = 'dialogs.rs'; Hits = 0; Text = 'pub fn q() { let _ = rfd::FileDialog::new(); }' },
        @{ File = 'keys.rs'; Hits = 1; Text = 'use windows::Win32::Networking::WinSock as W;' },
        @{ File = 'keys.rs'; Hits = 1; Text = 'use windows::Win32::Networking::WinSock::socket;' },
        @{ File = 'link.rs'; Hits = 0; Text = 'pub fn z() { let _ = windows::Win32::Networking::WinSock::connect(s, a, 16); }' },
        @{ File = 'link.rs'; Hits = 1; Text = 'pub fn z() { let _ = CreateFileW(p, 0, s, None, d, f, None); }' },
        @{ File = 'window.rs'; Hits = 1; Text = 'pub fn q() { let _ = CreateFileW(p, 0, s, None, d, f, None); }' },
        @{ File = 'reads.rs'; Hits = 0; Text = 'pub fn x() { let _ = CreateFileW(p, 0, s, None, d, f, None); let _ = ReadFile(h, b, n, None); }' },
        @{ File = 'reads.rs'; Hits = 1; Text = 'pub fn x() { let _ = WriteFile(h, b, n, None); }' },
        @{ File = 'reads.rs'; Hits = 1; Text = 'pub fn x() { let _ = DeleteFileW(p); }' },
        @{ File = 'writes.rs'; Hits = 1; Text = 'pub fn y() { let _ = ReadFile(h, b, n, None); }' },
        @{ File = 'writes.rs'; Hits = 0; Text = 'pub fn y() { let _ = CreateFileW(p, 0, s, None, d, f, None); let _ = WriteFile(h, b, n, None); let _ = MoveFileExW(a, b, f); }' },
        @{ File = 'window.rs'; Hits = 1; Text = 'pub fn q() { let _ = MoveFileExW(a, b, f); }' },
        @{ File = 'link.rs'; Hits = 1; Text = 'pub fn z() { let _ = CopyFileW(a, b, true); }' },
        @{ File = 'window.rs'; Hits = 1; Text = 'pub fn q() { let _ = CreateProcessW(a, c, None, None, false, f, None, d, si, pi); }' },
        @{ File = 'writes.rs'; Hits = 1; Text = 'pub fn y() { let _ = CreateProcessW(a, c, None, None, false, f, None, d, si, pi); }' },
        @{ File = 'supervise.rs'; Hits = 0; Text = 'pub fn s() { let _ = CreateProcessW(a, c, None, None, false, f, None, d, si, pi); }' }
    )
    $missed = @()
    foreach ($case in $plantedCases) {
        $got = @(Get-ScopeViolations @{ $case.File = $case.Text }).Count
        $good = if ($case.Hits -gt 0) { $got -ge 1 } else { $got -eq 0 }
        if (-not $good) { $missed += "$($case.File) [$($case.Text)] hits $got" }
    }
    if ($missed.Count -gt 0) { $Failures.Add("scope scan born-failing: $($missed -join '; ')") }
    Write-Host ("scope scan born-failing: {0} of {1} planted cases as expected" -f ($plantedCases.Count - $missed.Count), $plantedCases.Count)
}

function New-CrateCopy {
    param([string]$Destination)
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem $Crate -Force | Where-Object { $_.Name -ne 'gen' -and $_.Name -ne 'target' } |
        Copy-Item -Destination $Destination -Recurse -Force
}

function Invoke-Clippy {
    param([string]$CopyDir, [string]$Log)
    Push-Location $CopyDir
    try {
        $ErrorActionPreference = 'Continue'
        & cargo clippy --all-targets --locked --offline -- -D warnings *> $Log
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
    } finally { Pop-Location }
    return $code
}

function Add-PlantedCode {
    # Puts the planted function before the file's unit-test module, so Clippy's items_after_test_module lint
    # cannot be the reason a copy fails; a file without one gets it appended.
    param([string]$Path, [string]$Code)
    $text = [IO.File]::ReadAllText($Path)
    $at = $text.IndexOf("`n#[cfg(test)]")
    $planted = if ($at -ge 0) { $text.Insert($at + 1, "$Code`n`n") } else { "$text`n$Code`n" }
    [IO.File]::WriteAllText($Path, $planted, (New-Object Text.UTF8Encoding $false))
}

function Test-Case {
    param([hashtable]$Case, [string]$RunDir)
    $copy = Join-Path $RunDir "$($Case.Name)\src-tauri"
    New-CrateCopy $copy
    if ($Case.File) { Add-PlantedCode (Join-Path $copy $Case.File) $Case.Code }
    $log = Join-Path $RunDir "$($Case.Name).log"
    $code = Invoke-Clippy $copy $log
    $text = Get-Content $log -Raw
    if (-not $Case.File) {
        $ok = $code -eq 0
    } else {
        $lint = $text -match 'disallowed_(methods|types)|disallowed (method|type)|use of a disallowed'
        $ok = $code -ne 0 -and $lint -and $text.Contains($Case.Expect)
    }
    if (-not $ok) { $Failures.Add("$($Case.Name): clippy exit $code; see $log") }
    $verdict = if ($ok) { 'as expected' } else { 'NOT as expected' }
    Write-Host ("case {0,-9} clippy exit {1,3}  {2}" -f $Case.Name, $code, $verdict)
}

function Test-DenyBan {
    param([string]$RunDir)
    $copy = Join-Path $RunDir 'deny-ban\src-tauri'
    New-CrateCopy $copy
    $deny = Join-Path $copy 'deny.toml'
    $text = [IO.File]::ReadAllText($deny)
    $planted = $text.Replace('deny = [', "deny = [`n  { name = `"serde_json`", reason = `"planted ban`" },")
    [IO.File]::WriteAllText($deny, $planted, (New-Object Text.UTF8Encoding $false))
    Push-Location $copy
    try {
        $ErrorActionPreference = 'Continue'
        & cargo deny --locked --offline check bans *> (Join-Path $RunDir 'deny-ban.log')
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
    } finally { Pop-Location }
    if ($code -eq 0) { $Failures.Add('deny-ban: cargo deny passed a banned crate') }
    Write-Host ("case deny-ban   cargo deny exit {0}  {1}" -f $code, $(if ($code -ne 0) { 'as expected' } else { 'NOT as expected' }))
}

Set-BuildEnvironment
if ($ScopeOnly) {
    Test-Scope
} else {
    $run = Join-Path $Root (Get-Date -Format 'yyyyMMdd-HHmmss')
    New-Item -ItemType Directory -Force -Path $run | Out-Null
    Write-Host "plant-check: copies under $run, target $TargetDir"
    Test-Case @{ Name = 'clean'; File = $null } $run
    foreach ($case in $Cases) {
        if ($Only.Count -eq 0 -or $Only -contains $case.Name) { Test-Case $case $run }
    }
    if ($Only.Count -eq 0) {
        Test-DenyBan $run
        Test-Scope
    }
}
if ($Failures.Count -gt 0) {
    Write-Host "plant-check FAILED:"
    $Failures | ForEach-Object { Write-Host "  $_" }
    exit 1
}
Write-Host 'plant-check passed'
exit 0
