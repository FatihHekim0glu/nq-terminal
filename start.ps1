<#
.SYNOPSIS
  Start the nq-lab terminal (read only) on http://127.0.0.1:8765.

.DESCRIPTION
  From the nq-lab folder:
    powershell -NoProfile -ExecutionPolicy Bypass -File terminal\start.ps1

  Normal mode checks that the nq-lab venv imports FastAPI and uvicorn, builds web\dist when it is older
  than the front-end sources (pnpm install --frozen-lockfile, then pnpm build), starts the backend with
  the venv Python (module nq_terminal, run in terminal\backend; it binds 127.0.0.1 in code, port
  NQT_PORT) and opens the browser once /api/health answers. Ctrl+C stops it.

  -Dev runs the backend under uvicorn --reload on 127.0.0.1:8765 and the Vite dev server on
  127.0.0.1:5173, which proxies /api to the backend, and opens the browser on the dev server.

  If the port already answers as the terminal, the script opens the browser on it and starts nothing.
  Every path is quoted, so the spaced home folder works. Set NQT_FIXTURE_DIR first for fixture mode.

.PARAMETER Dev
  Development mode: uvicorn --reload plus the Vite dev server on 5173.
.PARAMETER Port
  Backend port on 127.0.0.1 (default 8765). -Dev needs 8765, where the Vite proxy points.
.PARAMETER NoBrowser
  Do not open the browser.
.PARAMETER NoBuild
  Serve web\dist as it is, even when it is older than the sources.
.PARAMETER DryRun
  Print the plan (paths, commands, port, build decision) and start nothing.
#>
[CmdletBinding()]
param(
    [switch]$Dev,
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765,
    [switch]$NoBrowser,
    [switch]$NoBuild,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Terminal = $PSScriptRoot
$Root = Split-Path -Parent $Terminal
$Backend = Join-Path $Terminal 'backend'
$Web = Join-Path $Terminal 'web'
$Dist = Join-Path $Web 'dist'
$Python = Join-Path $Root '.venv\Scripts\python.exe'
$ViteScript = 'node_modules/vite/bin/vite.js'
$Loopback = '127.0.0.1'
$ProxyPort = 8765
$DevPort = 5173
$StartupSeconds = 90
$Started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]

function Stop-Start([string]$Message) {
    [Console]::Error.WriteLine("start.ps1: $Message")
    exit 1
}

function Get-BackendArgs {
    if ($Dev) {
        return @('-m', 'uvicorn', 'nq_terminal.app:create_app', '--factory', '--reload',
            '--host', $Loopback, '--port', "$Port", '--no-server-header', '--no-proxy-headers')
    }
    return @('-m', 'nq_terminal')
}

function Get-NewestSourceTime {
    $files = @(Get-ChildItem -LiteralPath (Join-Path $Web 'src') -Recurse -File |
        Where-Object { $_.Name -notmatch '\.(test|gallery)\.' })
    foreach ($name in @('index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json')) {
        $path = Join-Path $Web $name
        if (Test-Path -LiteralPath $path) { $files += Get-Item -LiteralPath $path }
    }
    $public = Join-Path $Web 'public'
    if (Test-Path -LiteralPath $public) { $files += @(Get-ChildItem -LiteralPath $public -Recurse -File) }
    return ($files | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
}

function Test-BuildNeeded {
    $index = Join-Path $Dist 'index.html'
    if (-not (Test-Path -LiteralPath $index)) { return $true }
    return (Get-NewestSourceTime) -gt (Get-Item -LiteralPath $index).LastWriteTimeUtc
}

function Test-PortOpen([int]$Number) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect($Loopback, $Number, $null, $null)
        if (-not $wait.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($wait)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Test-TerminalAnswers([int]$Number) {
    try {
        $reply = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://${Loopback}:$Number/api/health"
        return ($reply.StatusCode -eq 200) -and ($reply.Content -match '"fence"')
    } catch {
        return $false
    }
}

function Test-PageAnswers([string]$Url) {
    try {
        return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $Url).StatusCode -eq 200
    } catch {
        return $false
    }
}

function Stop-Tree([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process -or $Process.HasExited) { return }
    & taskkill.exe /PID $Process.Id /T /F *> $null
}

function Wait-Until([scriptblock]$Ready, [string]$What) {
    $deadline = (Get-Date).AddSeconds($StartupSeconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Ready) { return }
        foreach ($p in $Started) {
            if ($p.HasExited) { Stop-Start "$What did not start: a process exited with code $($p.ExitCode)." }
        }
        Start-Sleep -Milliseconds 500
    }
    Stop-Start "$What did not answer within $StartupSeconds seconds."
}

function Open-Page([string]$Url) {
    if ($NoBrowser) { Write-Output "browser: not opened ($Url)"; return }
    Start-Process $Url
}

function Assert-Tools {
    if (-not (Test-Path -LiteralPath $Python)) { Stop-Start "no venv Python at $Python. Run uv sync in $Root first." }
    & $Python -c 'import fastapi, uvicorn' 2>$null
    if ($LASTEXITCODE -ne 0) { Stop-Start "the venv at $Python cannot import fastapi and uvicorn. Run uv sync in $Root." }
    if (($Dev -or -not $NoBuild) -and -not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Stop-Start 'pnpm is not on PATH; install pnpm 11, or start with -NoBuild to serve web\dist as it is.'
    }
}

function Invoke-Pnpm([string[]]$Arguments) {
    & pnpm --dir $Web @Arguments
    if ($LASTEXITCODE -ne 0) { Stop-Start "pnpm $($Arguments -join ' ') failed with code $LASTEXITCODE." }
}

function Write-Plan([bool]$BuildNeeded) {
    $url = if ($Dev) { "http://${Loopback}:$DevPort/" } else { "http://${Loopback}:$Port/" }
    Write-Output "mode: $(if ($Dev) { 'dev' } else { 'normal' })"
    Write-Output "root: $Root"
    Write-Output "check: $Python -c import fastapi, uvicorn"
    if ($Dev) {
        Write-Output "frontend: node $ViteScript (in $Web) on ${Loopback}:$DevPort, /api proxied to ${Loopback}:$ProxyPort"
    } elseif ($NoBuild) {
        Write-Output 'build: skipped (-NoBuild)'
    } else {
        Write-Output "build: $(if ($BuildNeeded) { 'needed' } else { 'up to date' }) ($Dist)"
    }
    Write-Output "backend: $Python $((Get-BackendArgs) -join ' ') (in $Backend)"
    Write-Output "env: NQT_PORT=$Port PYTHONUTF8=1"
    if ($env:NQT_FIXTURE_DIR) { Write-Output "env: NQT_FIXTURE_DIR=$env:NQT_FIXTURE_DIR (fixture mode)" }
    Write-Output "page: $url"
    if ($NoBrowser) { Write-Output 'browser: not opened' } else { Write-Output "browser: opens $url" }
}

function Start-Backend {
    $env:NQT_PORT = "$Port"
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $process = Start-Process -FilePath $Python -ArgumentList (Get-BackendArgs) -WorkingDirectory $Backend -NoNewWindow -PassThru
    $Started.Add($process)
    Wait-Until { Test-TerminalAnswers $Port } "The backend on ${Loopback}:$Port"
}

function Start-Frontend {
    if (-not (Test-Path -LiteralPath (Join-Path $Web $ViteScript))) { Invoke-Pnpm @('install', '--frozen-lockfile') }
    $node = (Get-Command node -ErrorAction Stop).Source
    $process = Start-Process -FilePath $node -ArgumentList $ViteScript -WorkingDirectory $Web -NoNewWindow -PassThru
    $Started.Add($process)
    Wait-Until { Test-PageAnswers "http://${Loopback}:$DevPort/" } "The Vite dev server on ${Loopback}:$DevPort"
}

function Wait-Started {
    Write-Output 'Running. Press Ctrl+C to stop.'
    while ($true) {
        foreach ($p in $Started) {
            if ($p.HasExited) { Write-Output "A process exited with code $($p.ExitCode); stopping."; return }
        }
        Start-Sleep -Milliseconds 500
    }
}

# ---------------------------------------------------------------- plan

if ($Dev -and $Port -ne $ProxyPort) {
    Stop-Start "-Dev needs port $ProxyPort, because web\vite.config.ts proxies /api to ${Loopback}:$ProxyPort."
}
$buildNeeded = (-not $Dev) -and (-not $NoBuild) -and (Test-BuildNeeded)
if ($DryRun) {
    Write-Plan $buildNeeded
    exit 0
}

# ---------------------------------------------------------------- run

$savedEnv = @{ NQT_PORT = $env:NQT_PORT; PYTHONUTF8 = $env:PYTHONUTF8; PYTHONIOENCODING = $env:PYTHONIOENCODING }
try {
    if (Test-PortOpen $Port) {
        if (-not (Test-TerminalAnswers $Port)) { Stop-Start "port $Port on $Loopback is taken by another program. Choose another with -Port." }
        Write-Output "The terminal already runs on http://${Loopback}:$Port/; nothing started."
        if (-not $Dev) { Open-Page "http://${Loopback}:$Port/"; exit 0 }
        Stop-Start "-Dev needs port $Port free for uvicorn --reload."
    }
    if ($Dev -and (Test-PortOpen $DevPort)) { Stop-Start "port $DevPort on $Loopback is taken; the Vite dev server needs it." }
    Assert-Tools
    if ($buildNeeded) {
        Write-Output 'Building web\dist (older than the sources).'
        Invoke-Pnpm @('install', '--frozen-lockfile')
        Invoke-Pnpm @('build')
    }
    Start-Backend
    if ($Dev) {
        Start-Frontend
        Open-Page "http://${Loopback}:$DevPort/"
    } else {
        Open-Page "http://${Loopback}:$Port/"
    }
    Write-Output "nq-lab terminal: http://${Loopback}:$(if ($Dev) { $DevPort } else { $Port })/ (read only)"
    Wait-Started
} finally {
    foreach ($p in $Started) { Stop-Tree $p }
    foreach ($name in $savedEnv.Keys) { Set-Item -Path "env:$name" -Value $savedEnv[$name] -ErrorAction SilentlyContinue }
}
