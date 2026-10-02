<#
.SYNOPSIS
  Start the nq-lab terminal (read only) on http://127.0.0.1:8765, behind the session token.

.DESCRIPTION
  From the nq-lab folder:
    powershell -NoProfile -ExecutionPolicy Bypass -File terminal\start.ps1

  Normal mode checks that the nq-lab venv imports FastAPI and uvicorn, builds web\dist when it is older
  than the front-end sources (pnpm install --frozen-lockfile, then pnpm build), and starts the backend with
  the venv Python (module nq_terminal, run in terminal\backend; it binds 127.0.0.1 in code on NQT_PORT, 8765
  by default) with an allow-listed environment. The launcher makes a 32-byte token and a nonce, writes them to
  the backend's input (never to argv, the environment or a URL) and keeps that pipe open for as long as this
  window runs: closing the window closes the pipe, and the backend stops its jobs and exits within 5 seconds.
  It then asks the backend for a one-time launch code (valid for 60 seconds) and opens
  http://127.0.0.1:<port>/session.html#<code>, a page that swaps the code for a session cookie and goes to
  the terminal. Ctrl+C stops it.

  When the lock file of the state folder names a live backend (one backend per lab) the launcher attaches: it
  asks the backend to prove who it is with a fresh nonce BEFORE it uses the token, then mints a code for it and
  starts nothing. An attached launcher never stops that backend.

  -Dev runs the backend under uvicorn --reload (it takes the lock like any backend; each reload retakes it and
  ends the sessions, so the launcher prints a fresh link) and the Vite dev server on 127.0.0.1:5173, which
  proxies /api to the port the lock records, and opens the dev origin's session page. When a backend already
  holds the lock, -Dev stops with a message: it needs its own reloading backend.

  With -NoBrowser nothing is opened: the session link is printed instead and Start-Process is never called.
  Every path is quoted, so the spaced home folder works. Set NQT_FIXTURE_DIR first for fixture mode, and
  NQT_STATE_DIR to keep the lock and the caches in a folder of your own (tests do).

.PARAMETER Dev
  Development mode: uvicorn --reload plus the Vite dev server (default port 5173).
.PARAMETER Port
  Backend port on 127.0.0.1 (default 8765, the origin that holds the owner's saved workspaces).
.PARAMETER DevPort
  Vite dev server port for -Dev (default 5173).
.PARAMETER NoBrowser
  Do not open the browser: print the one-time session link instead.
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
    [ValidateRange(1024, 65535)]
    [int]$DevPort = 5173,
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
$StartupSeconds = 90
$StopSeconds = 6
$StateDir = if ($env:NQT_STATE_DIR) { $env:NQT_STATE_DIR } else { Join-Path $Terminal 'state' }
$LockPath = Join-Path $StateDir 'backend.lock'
$Started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$script:BackendProcess = $null
$script:BackendInput = $null
$script:Token = $null
$script:ApiPort = $Port

function Stop-Start([string]$Message) {
    [Console]::Error.WriteLine("start.ps1: $Message")
    exit 1
}

function Get-BackendArgs {
    if ($Dev) {
        return @('-m', 'uvicorn', 'nq_terminal.app:create_app', '--factory', '--reload',
            '--host', $Loopback, '--port', "$Port", '--no-server-header', '--no-proxy-headers',
            '--timeout-graceful-shutdown', '2')
    }
    return @('-m', 'nq_terminal')
}

function Get-NewestSourceTime {
    $files = @(Get-ChildItem -LiteralPath (Join-Path $Web 'src') -Recurse -File |
        Where-Object { $_.Name -notmatch '\.(test|gallery)\.' })
    foreach ($name in @('index.html', 'session.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json')) {
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

# ---------------------------------------------------------------- the session door (03 sections 2.4 and 4.2)

function Invoke-LoopGet([string]$Url, [hashtable]$Headers = @{}) {
    try {
        return Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $Url -Headers $Headers
    } catch {
        return $null
    }
}

function New-HexString {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function ConvertFrom-HexString([string]$Hex) {
    $bytes = New-Object byte[] ($Hex.Length / 2)
    for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($Hex.Substring(2 * $i, 2), 16) }
    return , $bytes
}

function Test-SameText([string]$A, [string]$B) {
    if ($A.Length -ne $B.Length) { return $false }
    $difference = 0
    for ($i = 0; $i -lt $A.Length; $i++) { $difference = $difference -bor ([int][char]$A[$i] -bxor [int][char]$B[$i]) }
    return $difference -eq 0
}

# The backend's proof: HMAC-SHA256 keyed by the token's raw bytes over proof|nonce|port|pid (desktop/handshake.py).
function Get-ProofMac([string]$TokenHex, [string]$Nonce, [int]$MacPort, [int]$BackendPid) {
    $hmac = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList (, (ConvertFrom-HexString $TokenHex))
    try {
        $message = [System.Text.Encoding]::ASCII.GetBytes("proof|$Nonce|$MacPort|$BackendPid")
        return (($hmac.ComputeHash($message) | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
        $hmac.Dispose()
    }
}

# True only when the backend on $ConnectPort answers a FRESH nonce with the MAC of the token holder. The token is
# never sent here: this is the check that comes before it is used anywhere.
function Test-Backend([int]$ConnectPort, [string]$TokenHex, [int]$MacPort, [int]$ExpectedPid) {
    $nonce = New-HexString
    $reply = Invoke-LoopGet "http://${Loopback}:$ConnectPort/api/desktop/proof?nonce=$nonce"
    if ($null -eq $reply -or $reply.StatusCode -ne 200) { return $false }
    try { $body = $reply.Content | ConvertFrom-Json } catch { return $false }
    if ($null -eq $body.PSObject.Properties['proof'] -or $null -eq $body.PSObject.Properties['pid']) { return $false }
    $answerPid = 0
    if (-not [int]::TryParse("$($body.pid)", [ref]$answerPid)) { return $false }
    if ($ExpectedPid -gt 0 -and $answerPid -ne $ExpectedPid) { return $false }
    return Test-SameText ([string]$body.proof) (Get-ProofMac $TokenHex $nonce $MacPort $answerPid)
}

# Some terminal backend answers on the port: the proof route of this generation, or the health route of an older one.
function Test-TerminalAnswers([int]$Number) {
    $reply = Invoke-LoopGet "http://${Loopback}:$Number/api/desktop/proof?nonce=$('0' * 64)"
    if ($null -ne $reply -and $reply.StatusCode -eq 200 -and $reply.Content -match '"proof"') { return $true }
    $health = Invoke-LoopGet "http://${Loopback}:$Number/api/health"
    return ($null -ne $health) -and ($health.StatusCode -eq 200) -and ($health.Content -match '"fence"')
}

function Test-PageAnswers([string]$Url) {
    $reply = Invoke-LoopGet $Url
    return ($null -ne $reply) -and ($reply.StatusCode -eq 200)
}

function Get-LockField($Document, [string]$Name) {
    $property = $Document.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

# The lock the backend holds: pid, port and token, or $null when there is none or it is unreadable. The file is held
# open with share-read only; opening it for reading with every share flag is what the backend expects of a reader.
function Read-LockFile {
    if (-not (Test-Path -LiteralPath $LockPath)) { return $null }
    try {
        $stream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
            ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
        try {
            if ($stream.Length -gt 65536) { return $null }
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
            $text = $reader.ReadToEnd()
        } finally {
            $stream.Dispose()
        }
        $document = $text | ConvertFrom-Json
        $lockPid = 0
        $lockPort = 0
        $token = [string](Get-LockField $document 'token')
        $versionOk = "$(Get-LockField $document 'v')" -eq '1'
        $numbersOk = [int]::TryParse("$(Get-LockField $document 'pid')", [ref]$lockPid) -and [int]::TryParse("$(Get-LockField $document 'port')", [ref]$lockPort)
        if (-not ($versionOk -and $numbersOk) -or $token -notmatch '^[0-9a-f]{64}$' -or $lockPort -lt 1 -or $lockPort -gt 65535) { return $null }
        return [pscustomobject]@{ ProcessId = $lockPid; Port = $lockPort; Token = $token }
    } catch {
        return $null
    }
}

# A lock is believed only when this user, SYSTEM or Administrators own it and nobody else has rights on it (the
# backend creates it that way). Anything else is a file somebody planted: neither attached to nor replaced.
function Test-LockTrusted {
    try {
        $acl = Get-Acl -LiteralPath $LockPath
        $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $trusted = @($me, 'S-1-5-18', 'S-1-5-32-544')
        $sid = [System.Security.Principal.SecurityIdentifier]
        if ($trusted -notcontains $acl.GetOwner($sid).Value) { return $false }
        if (-not $acl.AreAccessRulesProtected) { return $false }
        foreach ($rule in $acl.Access) {
            if ($trusted -notcontains $rule.IdentityReference.Translate($sid).Value) { return $false }
        }
        return $true
    } catch {
        return $false
    }
}

# The backend the lock names, when it is alive and proves it holds the token. $null otherwise (no lock, a stale
# lock, or a backend that cannot prove itself); a lock that is not owner-only stops the launcher.
function Resolve-Attach {
    $lock = Read-LockFile
    if ($null -eq $lock) { return $null }
    if (-not (Test-LockTrusted)) { Stop-Start "the lock file $LockPath is not owner-only (another account owns it or has rights on it), so it is not used. Remove it if you did not expect it." }
    if ($null -eq (Get-Process -Id $lock.ProcessId -ErrorAction SilentlyContinue)) { return $null }
    if (Test-Backend $lock.Port $lock.Token $lock.Port $lock.ProcessId) { return $lock }
    return $null
}

function Get-LaunchCode([int]$ApiPortNumber, [string]$TokenHex) {
    $reply = Invoke-LoopGet "http://${Loopback}:$ApiPortNumber/api/session/code" @{ Authorization = "NQT $TokenHex" }
    if ($null -eq $reply -or $reply.StatusCode -ne 200) { return $null }
    try { $code = [string]($reply.Content | ConvertFrom-Json).code } catch { return $null }
    if ($code -notmatch '^[0-9a-f]{64}$') { return $null }
    return $code
}

# One launch code for the page at $Origin: opened in the browser, or printed with -NoBrowser (the only way the code is
# shown). Start-Process is called here and nowhere else, and never with -NoBrowser.
function Open-Session([int]$ApiPortNumber, [string]$Origin) {
    $code = Get-LaunchCode $ApiPortNumber $script:Token
    if ($null -eq $code) { Stop-Start "the backend on ${Loopback}:$ApiPortNumber did not issue a launch code." }
    $link = "$Origin/session.html#$code"
    if ($NoBrowser) {
        Write-Output "browser: not opened (open this link within 60 seconds: $link)"
        return
    }
    Write-Output 'browser: opening the session link (valid for 60 seconds, once).'
    Start-Process $link
}

# ---------------------------------------------------------------- processes

function Stop-Tree([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process -or $Process.HasExited) { return }
    & taskkill.exe /PID $Process.Id /T /F *> $null
}

function Join-Arguments([string[]]$Arguments) {
    return (($Arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' ')
}

function New-StartInfo([string]$File, [string[]]$Arguments, [string]$WorkingDirectory, [bool]$PipeInput) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = Join-Arguments $Arguments
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $PipeInput
    return $info
}

# The environment the backend gets: the allow list of desktop/envlist.py (shared with the app), never a copy of this
# shell's. The launcher's own settings are put in this shell first, so the list sees them as NQT_* names.
function Get-AllowedEnvironment {
    $code = 'import json; from nq_terminal.desktop.envlist import backend_env; print(json.dumps(backend_env()))'
    Push-Location $Backend
    try {
        $lines = @(& $Python -X utf8 -c $code)
        $failed = $LASTEXITCODE -ne 0
    } finally {
        Pop-Location
    }
    if ($failed -or $lines.Count -eq 0) { Stop-Start 'could not build the allow-listed environment for the backend (desktop/envlist.py).' }
    $table = @{}
    foreach ($property in ($lines[$lines.Count - 1] | ConvertFrom-Json).PSObject.Properties) { $table[$property.Name] = [string]$property.Value }
    return $table
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

function Assert-Tools {
    if (-not (Test-Path -LiteralPath $Python)) { Stop-Start "no venv Python at $Python. Run uv sync in $Root first." }
    & $Python -c 'import fastapi, uvicorn' 2>$null
    if ($LASTEXITCODE -ne 0) { Stop-Start "the venv at $Python cannot import fastapi and uvicorn. Run uv sync in $Root." }
    $needsPnpm = $buildNeeded -or -not (Test-Path -LiteralPath (Join-Path $Web $ViteScript))
    if ($needsPnpm -and ($Dev -or -not $NoBuild) -and -not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Stop-Start 'pnpm is not on PATH; install pnpm 11, or start with -NoBuild to serve web\dist as it is.'
    }
}

function Invoke-Pnpm([string[]]$Arguments) {
    & pnpm --dir $Web @Arguments
    if ($LASTEXITCODE -ne 0) { Stop-Start "pnpm $($Arguments -join ' ') failed with code $LASTEXITCODE." }
}

function Write-Plan([bool]$BuildNeeded) {
    $origin = if ($Dev) { "http://${Loopback}:$DevPort" } else { "http://${Loopback}:$Port" }
    $url = "$origin/"
    Write-Output "mode: $(if ($Dev) { 'dev' } else { 'normal' })"
    Write-Output "root: $Root"
    Write-Output "check: $Python -c import fastapi, uvicorn"
    if ($Dev) {
        Write-Output "frontend: node $ViteScript (in $Web) on ${Loopback}:$DevPort, /api proxied to the port the lock records (${Loopback}:$Port)"
    } elseif ($NoBuild) {
        Write-Output 'build: skipped (-NoBuild)'
    } else {
        Write-Output "build: $(if ($BuildNeeded) { 'needed' } else { 'up to date' }) ($Dist)"
    }
    Write-Output "backend: $Python $((Get-BackendArgs) -join ' ') (in $Backend)"
    $extra = if ($Dev) { ' NQT_DEV=1' } else { " NQT_STDIN_CONTROL=1$(if (-not $env:NQT_FIXTURE_DIR) { ' NQT_PREWARM=1' })" }
    Write-Output "env: NQT_PORT=$Port PYTHONUTF8=1$extra (the allow list of desktop/envlist.py; no other variable reaches the backend)"
    if ($env:NQT_FIXTURE_DIR) { Write-Output "env: NQT_FIXTURE_DIR=$env:NQT_FIXTURE_DIR (fixture mode)" }
    Write-Output "state: $StateDir (lock: $LockPath; a live backend named there is attached to after its proof, not replaced)"
    if ($Dev) {
        Write-Output 'token: the reloading backend makes its own and records it in the lock; -Dev stops when a backend already holds the lock'
    } else {
        Write-Output 'token: 32 random bytes written to the backend input with a nonce, never to argv, the environment or a URL; closing this window ends the backend'
    }
    Write-Output "page: $url"
    if ($NoBrowser) {
        Write-Output "browser: not opened (the one-time link $origin/session.html#<code> is printed instead)"
    } else {
        Write-Output "browser: opens $origin/session.html#<one-time code>"
    }
}

function Start-Backend {
    $env:NQT_PORT = "$Port"
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    if ($Dev) {
        # -Dev: the Vite dev origin joins the backend's same-origin list (settings.dev); never set otherwise. uvicorn
        # --reload restarts the process on each edit, so no prewarm, and it does not read the stdin channel.
        $env:NQT_DEV = '1'
    } else {
        # The plain launcher asks the backend to read TOKEN and NONCE on its input, and to warm the HOME computations
        # once its port is bound; fixture mode has no price source to warm.
        $env:NQT_STDIN_CONTROL = '1'
        if (-not $env:NQT_FIXTURE_DIR) { $env:NQT_PREWARM = '1' }
    }
    $info = New-StartInfo $Python (Get-BackendArgs) $Backend (-not $Dev)
    $info.EnvironmentVariables.Clear()
    $allowed = Get-AllowedEnvironment
    foreach ($name in $allowed.Keys) { $info.EnvironmentVariables[$name] = $allowed[$name] }
    $process = [System.Diagnostics.Process]::Start($info)
    $script:BackendProcess = $process
    $Started.Add($process)
    if ($Dev) { return }
    $script:Token = New-HexString
    $nonce = New-HexString
    # The pipe is written as raw bytes (no byte order mark, LF line ends) and kept open: it is the backend's parent link.
    $bytes = [System.Text.Encoding]::ASCII.GetBytes("TOKEN $($script:Token)`nNONCE $nonce`n")
    $script:BackendInput = $process.StandardInput
    $script:BackendInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $script:BackendInput.BaseStream.Flush()
}

function Wait-BackendReady {
    $deadline = (Get-Date).AddSeconds($StartupSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Dev) {
            $lock = Read-LockFile
            if ($null -ne $lock -and (Test-LockTrusted) -and (Test-Backend $Port $lock.Token $lock.Port $lock.ProcessId)) {
                $script:Token = $lock.Token
                return
            }
        } elseif (Test-Backend $Port $script:Token $Port 0) {
            # Any pid: the venv python.exe is a launcher that starts the real interpreter, so the pid the proof signs
            # is not the one this launcher started. Only the holder of the token can sign it.
            return
        }
        if ($script:BackendProcess.HasExited) { break }
        Start-Sleep -Milliseconds 400
    }
    if ($script:BackendProcess.HasExited -and $script:BackendProcess.ExitCode -eq 0 -and -not $Dev) {
        # NQT-ATTACH: a backend took the lock first. Attach to it only if it proves itself.
        $lock = Resolve-Attach
        if ($null -ne $lock) {
            $script:Token = $lock.Token
            $script:ApiPort = $lock.Port
            $Started.Remove($script:BackendProcess) | Out-Null
            $script:BackendProcess = $null
            $script:BackendInput = $null
            Write-Output "Attached to the backend that holds the lock (port $($lock.Port)); closing this window leaves it running."
            return
        }
        Stop-Start "a backend holds the lock in $StateDir but did not prove who it is, so it is not used. Stop it, or start with another NQT_STATE_DIR."
    }
    if ($script:BackendProcess.HasExited) {
        Stop-Start "The backend on ${Loopback}:$Port did not start: it exited with code $($script:BackendProcess.ExitCode). A busy port or an unreadable lock are the usual causes; its message is above."
    }
    Stop-Start "The backend on ${Loopback}:$Port did not answer within $StartupSeconds seconds."
}

function Start-Frontend {
    if (-not (Test-Path -LiteralPath (Join-Path $Web $ViteScript))) { Invoke-Pnpm @('install', '--frozen-lockfile') }
    $node = (Get-Command node -ErrorAction Stop).Source
    $info = New-StartInfo $node @($ViteScript) $Web $false
    # The dev server reads the lock for its proxy target and this port for its own (web\vite.config.ts).
    $info.EnvironmentVariables['NQT_DEV_PORT'] = "$DevPort"
    $process = [System.Diagnostics.Process]::Start($info)
    $Started.Add($process)
    Wait-Until { Test-PageAnswers "http://${Loopback}:$DevPort/" } "The Vite dev server on ${Loopback}:$DevPort"
}

# Ends what this launcher started. The backend gets its input closed first, which is the signal it stops on, and a
# short wait; whatever is still alive then (or was never given a pipe) is ended with its process tree.
function Stop-Started {
    if ($null -ne $script:BackendInput) {
        try { $script:BackendInput.Close() } catch { Write-Verbose 'the backend input was already closed' }
        if ($null -ne $script:BackendProcess) { [void]$script:BackendProcess.WaitForExit($StopSeconds * 1000) }
    }
    foreach ($p in $Started) { Stop-Tree $p }
}

function Wait-Started([string]$Origin) {
    Write-Output 'Running. Press Ctrl+C to stop.'
    $seen = $null
    if ($Dev) { $lock = Read-LockFile; if ($null -ne $lock) { $seen = $lock.ProcessId } }
    while ($true) {
        foreach ($p in $Started) {
            if ($p.HasExited) { Write-Output "A process exited with code $($p.ExitCode); stopping."; return }
        }
        if ($Dev) {
            # A reload ends every session (they live in memory), so hand over a new link when the backend changes.
            $lock = Read-LockFile
            if ($null -ne $lock -and $lock.ProcessId -ne $seen -and (Test-LockTrusted) -and (Test-Backend $Port $lock.Token $lock.Port $lock.ProcessId)) {
                $seen = $lock.ProcessId
                $script:Token = $lock.Token
                Write-Output 'The backend reloaded, which ended the sessions. A new link follows.'
                Open-Session $lock.Port $Origin
            }
        }
        Start-Sleep -Milliseconds 500
    }
}

# ---------------------------------------------------------------- plan

if ($Dev -and $Port -eq $DevPort) {
    Stop-Start "-Dev needs different ports for the backend ($Port) and the Vite dev server ($DevPort)."
}
$buildNeeded = (-not $Dev) -and (-not $NoBuild) -and (Test-BuildNeeded)
if ($DryRun) {
    Write-Plan $buildNeeded
    exit 0
}

# ---------------------------------------------------------------- run

$savedEnv = @{ NQT_PORT = $env:NQT_PORT; PYTHONUTF8 = $env:PYTHONUTF8; PYTHONIOENCODING = $env:PYTHONIOENCODING; NQT_PREWARM = $env:NQT_PREWARM; NQT_DEV = $env:NQT_DEV; NQT_STDIN_CONTROL = $env:NQT_STDIN_CONTROL }
try {
    $attached = Resolve-Attach
    if ($null -ne $attached) {
        if ($Dev) {
            Stop-Start "-Dev needs its own reloading backend, but a backend already holds the lock in $StateDir (port $($attached.Port)). Stop that backend first."
        }
        Write-Output "The terminal already runs on http://${Loopback}:$($attached.Port)/ (the lock names it, and it proved who it is); nothing started."
        $script:Token = $attached.Token
        Open-Session $attached.Port "http://${Loopback}:$($attached.Port)"
        exit 0
    }
    if (Test-PortOpen $Port) {
        if (Test-TerminalAnswers $Port) {
            Stop-Start "a terminal on ${Loopback}:$Port has no lock file or token (an older version). Close its window, or stop that process, then start again."
        }
        Stop-Start "port $Port on $Loopback is taken by another program. Choose another with -Port."
    }
    if ($Dev -and (Test-PortOpen $DevPort)) { Stop-Start "port $DevPort on $Loopback is taken; the Vite dev server needs it. Choose another with -DevPort." }
    Assert-Tools
    if ($buildNeeded) {
        Write-Output 'Building web\dist (older than the sources).'
        Invoke-Pnpm @('install', '--frozen-lockfile')
        Invoke-Pnpm @('build')
    }
    Start-Backend
    Wait-BackendReady
    if ($Dev) {
        Start-Frontend
        $origin = "http://${Loopback}:$DevPort"
    } else {
        $origin = "http://${Loopback}:$($script:ApiPort)"
    }
    Open-Session $script:ApiPort $origin
    Write-Output "nq-lab terminal: $origin/ (read only)"
    if ($null -ne $script:BackendInput) {
        Write-Output 'Closing this window stops the terminal: the backend sees its input close, stops any running job and exits within 5 seconds.'
    }
    Wait-Started $origin
} finally {
    Stop-Started
    foreach ($name in $savedEnv.Keys) { Set-Item -Path "env:$name" -Value $savedEnv[$name] -ErrorAction SilentlyContinue }
}
