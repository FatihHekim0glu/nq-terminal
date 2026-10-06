# Born-failing tests of scripts\smoke_real.ps1: the backend of a smoke run gets a temporary state folder and the job queue off,
# and the folder is removed afterwards.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\smoke_real.tests.ps1
#
# Nothing here starts a server, a browser or the real lab: the script's own -SelfTest runs on files in a temporary folder, and its
# two state functions are cut out of the script by its syntax tree and run on a scratch folder.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Script = (Resolve-Path (Join-Path $PSScriptRoot '..\smoke_real.ps1')).Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Text = [System.IO.File]::ReadAllText($Script, $Utf8)
$Passed = 0
$Failed = New-Object System.Collections.Generic.List[string]

function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:Passed++; Write-Host "PASS  $Name" } else { $Failed.Add($Name); Write-Host "FAIL  $Name  $Detail" }
}

$tokens = $null
$errors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseInput($Text, [ref]$tokens, [ref]$errors)
Check 'smoke_real.ps1 parses' ($errors.Count -eq 0) "$errors"
$functions = @{}
foreach ($f in $tree.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { $functions[$f.Name] = $f }

# ---- the self-test of the script itself ------------------------------------------------------------------------------------------
$ErrorActionPreference = 'Continue'  # a native command's stderr must not end this run
$run = & powershell -NoProfile -ExecutionPolicy Bypass -File $Script -SelfTest 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$output = $run -join "`n"
Check 'the script self-test passes' ($code -eq 0 -and $output -match 'self-test passed') "exit $code"
Check 'the self-test covers the temporary state folder' ($output -match 'self-test ok\s+the smoke state folder is made inside the work folder')
Check 'the self-test covers the job queue being off' ($output -match 'self-test ok\s+the job queue is off whatever the caller set')
Check 'the self-test covers the removal afterwards' ($output -match 'self-test ok\s+the smoke state folder is removed afterwards')
Check 'the self-test covers the refusal to remove a folder that is not the run own state' ($output -match 'self-test ok\s+a folder that is not the run own state is refused')

# ---- the two functions, run here -------------------------------------------------------------------------------------------------
Check 'New-SmokeState and Remove-SmokeState exist' ($functions.ContainsKey('New-SmokeState') -and $functions.ContainsKey('Remove-SmokeState'))
if ($functions.ContainsKey('New-SmokeState') -and $functions.ContainsKey('Remove-SmokeState')) {
    foreach ($name in 'New-SmokeState', 'Remove-SmokeState') { Invoke-Expression $functions[$name].Extent.Text }
    $base = Join-Path 'D:\dev\tmp' ("smoke-real-tests-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N').Substring(0, 6))
    $work = Join-Path $base 'nqt-smoke-20260101-000000'
    $savedState = $env:NQT_STATE_DIR
    $savedJobs = $env:NQT_JOBS
    try {
        New-Item -ItemType Directory -Force -Path $work | Out-Null
        $env:NQT_STATE_DIR = 'D:\somewhere\else'
        $env:NQT_JOBS = 'on'
        $state = New-SmokeState $work
        Check 'the state folder is made inside the work folder' ((Test-Path -LiteralPath $state -PathType Container) -and ((Split-Path -Parent $state) -eq $work))
        Check 'NQT_STATE_DIR names it, whatever the caller had' ($env:NQT_STATE_DIR -eq $state)
        Check 'NQT_JOBS is off, whatever the caller had' ($env:NQT_JOBS -eq 'off')
        [System.IO.File]::WriteAllText((Join-Path $state 'backend.lock'), "x`n", $Utf8)
        $other = Join-Path $base 'owner-state'
        New-Item -ItemType Directory -Force -Path $other | Out-Null
        Check 'a folder that is not the one made is refused and kept' ((-not (Remove-SmokeState $work $other)) -and (Test-Path -LiteralPath $other))
        Check 'the state folder is removed with its contents, and the work folder stays' ((Remove-SmokeState $work $state) -and (-not (Test-Path -LiteralPath $state)) -and (Test-Path -LiteralPath $work))
    } finally {
        $env:NQT_STATE_DIR = $savedState
        $env:NQT_JOBS = $savedJobs
        if (Test-Path -LiteralPath $base) { Remove-Item -LiteralPath $base -Recurse -Force }
    }
}

# ---- the main flow uses them ---------------------------------------------------------------------------------------------------------
Check 'the browser flow makes its state folder with New-SmokeState' ($Text -match '\$State = New-SmokeState \$Work')
Check 'no state folder is made by hand any more' (-not ($Text -cmatch '\$env:NQT_STATE_DIR = \$State'))
$stopAt = $Text.IndexOf('foreach ($p in $started) { Stop-Tree $p }')
$removeAt = $Text.IndexOf('Remove-SmokeState $Work $State')
Check 'the state folder is removed after the servers stop, in the finally block' ($stopAt -gt 0 -and $removeAt -gt $stopAt)
Check 'the run outcome notes a state folder that could not be removed' ($Text -match 'could not be removed')

Write-Host ''
Write-Host ("smoke_real tests: {0} passed, {1} failed" -f $Passed, $Failed.Count)
if ($Failed.Count -gt 0) { Write-Host ("FAILED: " + ($Failed -join '; ')); exit 1 }
exit 0
