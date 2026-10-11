# Born-failing tests of the -Coverage switch of scripts\record_green.ps1 (V04 w2a-supply-chain, slice coverage).
#
#   powershell -NoProfile -File scripts\tests\record_green.tests.ps1
#
# -Coverage adds the pytest-cov figure to the backend green record. Its output (the data file and the JSON report) goes
# to a folder outside the repository and the lab (default D:\dev\v04\coverage). Every guard is shown to refuse its
# planted bad case (a coverage folder inside the repository, by a plain path, a ".." path or a junction; a report that
# is missing, stale or unreadable; a check other than backend) and to pass the clean case. Everything runs against a
# scratch git tree and scratch folders under D:\dev\tmp with the script's self-test hooks; no test starts pytest or
# writes under the real tree.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Scripts = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Terminal = Split-Path $Scripts -Parent
$Record = Join-Path $Scripts 'record_green.ps1'
$Scratch = Join-Path 'D:\dev\tmp\w2a-coverage-tests' ("rg-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N').Substring(0, 6))
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Shell = (Get-Command powershell).Source
$ReportName = 'backend.coverage.json'
$Passed = 0
$Failed = New-Object System.Collections.Generic.List[string]
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$env:TEMP = $Scratch
$env:TMP = $Scratch

function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:Passed++; Write-Host "PASS  $Name" } else { $Failed.Add($Name); Write-Host "FAIL  $Name  $Detail" }
}

function New-Tree {
    # A scratch git tree with one commit and no hooks.
    param([string]$Name)
    $dir = Join-Path $Scratch $Name
    $ErrorActionPreference = 'Continue'
    New-Item -ItemType Directory -Force -Path (Join-Path $dir '.nohooks') | Out-Null
    & git -C $dir init -q 2>&1 | Out-Null
    & git -C $dir config commit.gpgsign false
    & git -C $dir config core.hooksPath (Join-Path $dir '.nohooks')
    & git -C $dir config user.name tester
    & git -C $dir config user.email tester@example.invalid
    & git -C $dir config core.autocrlf false
    [System.IO.File]::WriteAllText((Join-Path $dir 'a.txt'), "one`n", $Utf8)
    & git -C $dir add a.txt
    & git -C $dir commit -q -m 'init' 2>&1 | Out-Null
    $ErrorActionPreference = 'Stop'
    return $dir
}

function Write-Fixture {
    # A coverage.py JSON report shaped like the real one: totals, and per-file summaries under two areas plus one root module.
    param([string]$Path)
    $summary = { param($covered, $statements) [ordered]@{ covered_lines = $covered; num_statements = $statements; percent_covered = [math]::Round(100.0 * $covered / $statements, 2); missing_lines = $statements - $covered; excluded_lines = 0 } }
    $files = [ordered]@{
        'E:\x\backend\nq_terminal\api\a.py' = [ordered]@{ summary = (& $summary 8 10); functions = [ordered]@{ '' = [ordered]@{ summary = (& $summary 1 1) } } }
        'E:\x\backend\nq_terminal\api\b.py' = [ordered]@{ summary = (& $summary 2 10); functions = [ordered]@{ '' = [ordered]@{ summary = (& $summary 1 1) } } }
        'E:\x\backend\nq_terminal\services\c.py' = [ordered]@{ summary = (& $summary 30 30); functions = [ordered]@{ '' = [ordered]@{ summary = (& $summary 1 1) } } }
        'E:\x\backend\nq_terminal\app.py' = [ordered]@{ summary = (& $summary 5 10); functions = [ordered]@{ '' = [ordered]@{ summary = (& $summary 1 1) } } }
    }
    $body = [ordered]@{ meta = [ordered]@{ version = '7.16.1' }; files = $files; totals = (& $summary 45 60) }
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    [System.IO.File]::WriteAllText($Path, ($body | ConvertTo-Json -Depth 6), $Utf8)
}

function Invoke-Rg {
    # record_green.ps1 -Check backend -Coverage with the -Exe hook; returns the exit code and what it printed.
    param([string]$Tree, [string]$CovDir, [string]$Records, [string]$HookCommand, [string[]]$Extra = @())
    $ErrorActionPreference = 'Continue'
    $text = (& $Record -Check backend -Coverage -CoverageDir $CovDir -TreeRoot $Tree -RecordsDir $Records -Exe $Shell -ExeArgs @('-NoProfile', '-Command', $HookCommand) @Extra *>&1 | ForEach-Object { "$_" }) -join "`n"
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    return @{ code = $code; text = $text }
}

function Get-TodayFile {
    param([string]$Dir, [string]$Check = 'backend')
    return Join-Path $Dir ((Get-Date).ToString('yyyy-MM-dd') + "_$Check.json")
}

# ---- the coverage folder inside the repository is refused (born failing) -------------------------------------------------
$tree = New-Tree 'tree'
$records = Join-Path $Scratch 'records'
$marker = Join-Path $Scratch 'ran.marker'
$ranHook = "Set-Content -Path '$marker' -Value ran; exit 0"

$r = Invoke-Rg $tree (Join-Path $tree 'cov') $records $ranHook
Check 'a -Coverage run that would write inside the repository is refused (born failing)' (($r.code -eq 2) -and ($r.text -match 'inside the repository')) "code $($r.code): $($r.text)"
Check 'the refused run started nothing, made no folder and no record' (-not (Test-Path $marker) -and -not (Test-Path (Join-Path $tree 'cov')) -and -not (Test-Path $records))

$r = Invoke-Rg $tree $tree $records $ranHook
Check 'the repository root itself is refused as the coverage folder' (($r.code -eq 2) -and -not (Test-Path $marker))

$r = Invoke-Rg $tree (Join-Path $tree 'sub\..\cov') $records $ranHook
Check 'a path with .. that lands inside the repository is refused' (($r.code -eq 2) -and -not (Test-Path $marker) -and -not (Test-Path (Join-Path $tree 'cov')))

$null = & cmd /c mklink /J (Join-Path $Scratch 'cov-link') $tree 2>&1
$r = Invoke-Rg $tree (Join-Path $Scratch 'cov-link\out') $records $ranHook
Check 'a junction that leads into the repository is refused' (($r.code -eq 2) -and -not (Test-Path $marker) -and -not (Test-Path (Join-Path $tree 'out')))
& cmd /c rmdir (Join-Path $Scratch 'cov-link') | Out-Null

$realCov = Join-Path $Terminal 'cov-should-not-exist'
$r = Invoke-Rg $tree $realCov $records $ranHook
$realMade = Test-Path -LiteralPath $realCov
if ($realMade) { Remove-Item -LiteralPath $realCov -Recurse -Force }
Check 'a folder inside the real terminal tree is refused and not made' (($r.code -eq 2) -and -not $realMade -and -not (Test-Path $marker))

$sibling = $tree + '-other'
$r = Invoke-Rg $tree (Join-Path $sibling 'cov') $records "Write-Output '1 passed'; exit 0"
Check 'a sibling folder that only shares the repository name as a prefix is not mistaken for inside it' ($r.text -notmatch 'inside the repository') $r.text

$ErrorActionPreference = 'Continue'; $null = & $Record -Check crosscheck -Coverage -CoverageDir (Join-Path $Scratch 'cov-x') -TreeRoot $tree -RecordsDir $records -Exe $Shell -ExeArgs @('-NoProfile', '-Command', "Set-Content -Path '$marker' -Value ran; exit 0") *>&1; $ErrorActionPreference = 'Stop'
Check '-Coverage with a check other than backend is refused (born failing)' (($LASTEXITCODE -eq 2) -and -not (Test-Path $marker))

# ---- the report: missing, stale, unreadable, then the clean record ---------------------------------------------------------
$cov = Join-Path $Scratch 'cov-ok'
$report = Join-Path $cov $ReportName
$recDir = Join-Path $Scratch 'rg-records'
$Fixture = Join-Path $Scratch 'fixture-report.json'   # outside the coverage folder, which a run clears of stale files
$passOut = "Write-Output '12 passed, 3 skipped in 1.2s'; exit 0"

$r = Invoke-Rg $tree $cov $recDir $passOut
Check 'a pass with no coverage report writes no record (born failing)' (($r.code -eq 1) -and ($r.text -match 'coverage report') -and -not (Test-Path (Get-TodayFile $recDir))) "code $($r.code): $($r.text)"

Write-Fixture $report
$r = Invoke-Rg $tree $cov $recDir $passOut
Check 'a stale report from an earlier run is not read: no record (born failing)' (($r.code -eq 1) -and -not (Test-Path (Get-TodayFile $recDir))) "code $($r.code): $($r.text)"

$r = Invoke-Rg $tree $cov $recDir "Write-Output '12 passed in 1s'; Set-Content -Path '$report' -Value 'not json {'; exit 0"
Check 'an unreadable report writes no record (born failing)' (($r.code -eq 1) -and ($r.text -match 'coverage report') -and -not (Test-Path (Get-TodayFile $recDir))) "code $($r.code): $($r.text)"

$r = Invoke-Rg $tree $cov $recDir "Write-Output '12 passed in 1s'; Set-Content -Path '$report' -Value '{`"totals`":{}}'; exit 0"
Check 'a report without the totals writes no record (born failing)' (($r.code -eq 1) -and -not (Test-Path (Get-TodayFile $recDir)))

Write-Fixture $Fixture
$r = Invoke-Rg $tree $cov $recDir "Write-Output '2 failed'; Copy-Item '$Fixture' '$report'; exit 3"
Check 'a failing check writes no record whatever the report says' (($r.code -eq 1) -and -not (Test-Path (Get-TodayFile $recDir)))

$envOut = Join-Path $Scratch 'covfile.txt'
$good = "Write-Output '12 passed, 3 skipped in 1.2s'; Set-Content -Path '$envOut' -Value `$env:COVERAGE_FILE; Copy-Item '$Fixture' '$report'; exit 0"
$before = $env:COVERAGE_FILE
$r = Invoke-Rg $tree $cov $recDir $good
$file = Get-TodayFile $recDir
Check 'a passing run with a report writes the record' (($r.code -eq 0) -and (Test-Path $file)) "code $($r.code): $($r.text)"
$rec = if (Test-Path $file) { Get-Content -Raw $file | ConvertFrom-Json } else { $null }
if ($rec) {
    $c = $rec.coverage
    Check 'a report with empty property names, as pytest-cov writes it, is read (born failing)' ($null -ne $rec.coverage)
    Check 'the record carries the backend figure: percent, covered, statements, missing, files' (($c.percent -eq 75) -and ($c.covered_lines -eq 45) -and ($c.num_statements -eq 60) -and ($c.missing_lines -eq 15) -and ($c.files -eq 4)) ($c | ConvertTo-Json)
    Check 'the record names the tool, the source package and the report path' (($c.tool -eq 'pytest-cov') -and ($c.source -eq 'nq_terminal') -and ($c.report -eq $report))
    Check 'the record has a percent per area: api 50, services 100, the root module 50' (($c.areas.api -eq 50) -and ($c.areas.services -eq 100) -and ($c.areas.'(root)' -eq 50)) ($c.areas | ConvertTo-Json)
    Check 'the pass counts and the canonical command are unchanged by -Coverage' (($rec.counts.passed -eq 12) -and ($rec.counts.skipped -eq 3) -and ($rec.command -match 'pytest') -and ($rec.command -notmatch '--cov'))
    Check 'a -Coverage record made through the hook is still a self-test record' ($rec.self_test -eq $true)
}
Check 'the data file goes to the coverage folder (COVERAGE_FILE)' ((Test-Path $envOut) -and ((Get-Content -Raw $envOut).Trim() -eq (Join-Path $cov 'backend.coverage')))
Check 'COVERAGE_FILE is put back afterwards' ($env:COVERAGE_FILE -eq $before)
Check 'nothing was written in the tree but git''s own files' (@(Get-ChildItem $tree -Force | Where-Object { $_.Name -notin '.git', '.nohooks', 'a.txt' }).Count -eq 0)

# ---- a run without -Coverage is unchanged (regression guard) -----------------------------------------------------------------
$plainDir = Join-Path $Scratch 'rg-plain'
$ErrorActionPreference = 'Continue'; $null = & $Record -Check backend -TreeRoot $tree -RecordsDir $plainDir -Exe $Shell -ExeArgs @('-NoProfile', '-Command', $passOut) *>&1; $ErrorActionPreference = 'Stop'
$plainFile = Get-TodayFile $plainDir
$plain = if (Test-Path $plainFile) { Get-Content -Raw $plainFile | ConvertFrom-Json } else { $null }
Check 'a run without -Coverage has no coverage block (regression guard)' (($null -ne $plain) -and ($null -eq $plain.PSObject.Properties['coverage']))

# ---- the pytest command that -Coverage builds, through a stub python -----------------------------------------------------------
function New-ArgLogLab {
    param([string]$Name)
    $lab = Join-Path $Scratch $Name
    New-Item -ItemType Directory -Force -Path (Join-Path $lab '.venv\Scripts') | Out-Null
    $source = 'public static class ArgLogPython { public static int Main(string[] a) { if (a.Length > 0 && a[0] == "-c") return 1; var log = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location), "args.log"); System.IO.File.AppendAllText(log, string.Join(" ", a) + " COVERAGE_FILE=" + System.Environment.GetEnvironmentVariable("COVERAGE_FILE") + "\n"); return 0; } }'
    Add-Type -TypeDefinition $source -OutputAssembly (Join-Path $lab '.venv\Scripts\python.exe') -OutputType ConsoleApplication
    return $lab
}
$argLab = New-ArgLogLab 'arglog'
$argCov = Join-Path $Scratch 'cov-args'
$ErrorActionPreference = 'Continue'; $null = & $Record -Check backend -Coverage -CoverageDir $argCov -Lab $argLab -RecordsDir (Join-Path $Scratch 'rg-arglog') *>&1; $ErrorActionPreference = 'Stop'
$argCode = $LASTEXITCODE
$logFile = Join-Path $argLab '.venv\Scripts\args.log'
$logged = if (Test-Path -LiteralPath $logFile) { Get-Content -Raw -LiteralPath $logFile } else { '' }
Check 'the pytest command gets --cov=nq_terminal and a JSON report in the coverage folder (born failing)' (($logged -match '--cov=nq_terminal') -and ($logged -match [regex]::Escape("--cov-report=json:$argCov\$ReportName"))) $logged
Check 'it keeps the plain output of pytest (no terminal coverage table) and sets no fail-under' (($logged -notmatch '--cov-report=term') -and ($logged -notmatch 'fail-under'))
Check 'it puts the data file in the coverage folder' ($logged -match [regex]::Escape("COVERAGE_FILE=$argCov\backend.coverage"))
Check 'the stub run, which writes no report, leaves no record (born failing)' (($argCode -eq 1) -and -not (Test-Path (Get-TodayFile (Join-Path $Scratch 'rg-arglog'))))

Remove-Item -LiteralPath $logFile -Force
$ErrorActionPreference = 'Continue'; $null = & $Record -Check backend -Lab $argLab -RecordsDir (Join-Path $Scratch 'rg-arglog-plain') *>&1; $ErrorActionPreference = 'Stop'
$plainLogged = Get-Content -Raw -LiteralPath $logFile
Check 'without -Coverage the pytest command has no --cov (regression guard)' (($plainLogged -notmatch '--cov') -and ($plainLogged -match 'COVERAGE_FILE=\s'))

# ---- the default coverage folder ------------------------------------------------------------------------------------------------
$text = [System.IO.File]::ReadAllText($Record, $Utf8)
Check 'the default coverage folder is D:\dev\v04\coverage, outside the repository' ($text -match [regex]::Escape("'D:\dev\v04\coverage'"))

Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host "record_green.tests: $Passed passed, $($Failed.Count) failed"
if ($Failed.Count -gt 0) { $Failed | ForEach-Object { Write-Host "  FAILED: $_" }; exit 1 }
exit 0
