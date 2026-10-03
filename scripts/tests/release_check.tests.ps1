# Born-failing tests of scripts\record_green.ps1 and scripts\release_check.ps1 (04 D5.4, 05 S08).
#
#   powershell -NoProfile -File scripts\tests\release_check.tests.ps1
#
# Every guard is shown to refuse its planted bad case (a record from the day before, a record whose stamp differs, a
# record of another PC or with a failing exit code, a changed artefact, a wrong version, a tag that exists, a check
# that fails or changes the tree while it runs) and to pass the clean case. Everything runs against a scratch git tree
# and scratch folders under D:\dev\tmp, with the scripts' self-test hooks; nothing under the real tree is written.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Scripts = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Record = Join-Path $Scripts 'record_green.ps1'
$ReleaseCheck = Join-Path $Scripts 'release_check.ps1'
$Scratch = Join-Path 'D:\dev\tmp\w5a-package-tests' ("rc-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N').Substring(0, 6))
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Today = '2026-10-03'
$Yesterday = '2026-10-02'
$Pc = 'TEST-PC'
$Passed = 0
$LastText = ''
$Failed = New-Object System.Collections.Generic.List[string]
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$env:TEMP = $Scratch
$env:TMP = $Scratch

function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:Passed++; Write-Host "PASS  $Name" } else { $Failed.Add($Name); Write-Host "FAIL  $Name  $Detail  [last release_check output: $script:LastText]" }
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

function Get-TreeStamp {
    param([string]$Tree)
    return (((& powershell -NoProfile -ExecutionPolicy Bypass -File $Record -Stamp -TreeRoot $Tree) -join "`n") | ConvertFrom-Json)
}

function Get-CanonicalCommand {
    # The command text record_green.ps1 writes for a real run of each check (paths vary, the shape does not).
    param([string]$Check)
    # release_check.ps1 compares the text exactly, so the paths are the real terminal and its parent (the lab).
    $terminal = Split-Path $Scripts -Parent
    $lab = Split-Path $terminal -Parent
    $smoke = "powershell -NoProfile -ExecutionPolicy Bypass -File $terminal\scripts\smoke_real.ps1"
    switch ($Check) {
        'backend' { return "$lab\.venv\Scripts\python.exe -m pytest -p no:warnings -o addopts= -q $terminal\backend\tests" }
        'crosscheck' { return "uv run --project $terminal\qa python -m crosscheck --strict ; then uv run --project $terminal\qa python -m crosscheck.served" }
        'smoke' { return $smoke }
        'smoke-app' { return "$smoke -Mode App" }
    }
}

function Write-RecordFile {
    param([string]$Dir, [string]$Date, [string]$Check, $Stamp, [string]$Computer = $Pc, [int]$Code = 0, [string]$Command = '', $SelfTest = $false)
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    if (-not $Command) { $Command = Get-CanonicalCommand $Check }
    $body = [ordered]@{ check = $Check; date = $Date; pc = $Computer; exit_code = $Code; counts = @{}; command = $Command; self_test = $SelfTest; stamp = $Stamp }
    [System.IO.File]::WriteAllText((Join-Path $Dir "${Date}_$Check.json"), ($body | ConvertTo-Json -Depth 5), $Utf8)
}

# The inputs a check reads that the tree stamp does not cover: the smoke exe, web\dist and the QA dumps (fake ones here).
$InputsRoot = Join-Path $Scratch 'inputs'
$SmokeExeFile = Join-Path $InputsRoot 'smoke\nq-lab-terminal.exe'
$DistFolder = Join-Path $InputsRoot 'dist'
$DumpsFolder = Join-Path $InputsRoot 'dumps'
New-Item -ItemType Directory -Force -Path (Split-Path $SmokeExeFile), (Join-Path $DistFolder 'assets'), $DumpsFolder | Out-Null
[System.IO.File]::WriteAllText($SmokeExeFile, 'smoke exe bytes', $Utf8)
[System.IO.File]::WriteAllText((Join-Path $DistFolder 'index.html'), '<html></html>', $Utf8)
[System.IO.File]::WriteAllText((Join-Path $DistFolder 'assets\app.js'), 'console.log(1)', $Utf8)
[System.IO.File]::WriteAllText((Join-Path $DumpsFolder 'nqt_a.json'), '{"a":1}', $Utf8)
$StartedUtc = (Get-Date).ToUniversalTime().AddMinutes(-5).ToString('o')
[System.IO.File]::SetLastWriteTimeUtc((Join-Path $DumpsFolder 'nqt_a.json'), (Get-Date).ToUniversalTime().AddMinutes(-2))

function Get-InputsJson {
    param([string]$Dist = $DistFolder, [string]$Dumps = $DumpsFolder)
    # The current inputs as record_green.ps1 -Inputs reports them (the same code the records use).
    return (((& powershell -NoProfile -ExecutionPolicy Bypass -File $Record -Inputs -SmokeExe $SmokeExeFile -DistDir $Dist -DumpsDir $Dumps) -join "`n") | ConvertFrom-Json)
}

function Write-InputRecord {
    # A record with the inputs block (and the run's start) that record_green.ps1 writes.
    param([string]$Dir, [string]$Date, [string]$Check, $Stamp, $Inputs = $null, [string]$Started = $script:StartedUtc)
    Write-RecordFile $Dir $Date $Check $Stamp
    $file = Join-Path $Dir "${Date}_$Check.json"
    $body = Get-Content -Raw -Path $file -Encoding UTF8 | ConvertFrom-Json
    $body | Add-Member -NotePropertyName started_utc -NotePropertyValue $Started -Force
    if ($null -ne $Inputs) { $body | Add-Member -NotePropertyName inputs -NotePropertyValue $Inputs -Force }
    [System.IO.File]::WriteAllText($file, ($body | ConvertTo-Json -Depth 6), $Utf8)
}

function Write-Records {
    param([string]$Dir, [string]$Date, $Stamp)
    $inputs = Get-InputsJson
    $appInputs = [pscustomobject]@{ smoke_exe = $inputs.smoke_exe; web_dist = $inputs.web_dist }
    Write-InputRecord $Dir $Date 'backend' $Stamp
    Write-InputRecord $Dir $Date 'crosscheck' $Stamp $inputs
    Write-InputRecord $Dir $Date 'smoke' $Stamp
    Write-InputRecord $Dir $Date 'smoke-app' $Stamp $appInputs
}

function New-ReleaseDir {
    # A release folder whose PROVENANCE.json and SHA256SUMS are right for $Stamp and $Version.
    param([string]$Name, $Stamp, [string]$Version, [string]$SmokeSha = '')
    $dir = Join-Path $Scratch $Name
    New-Item -ItemType Directory -Force -Path (Join-Path $dir 'payload') | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $dir 'payload\a.bin'), 'artefact bytes', $Utf8)
    if (-not $SmokeSha) { $SmokeSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $SmokeExeFile).Hash.ToLowerInvariant() }
    $files = @([ordered]@{ path = 'payload/smoke/nq-lab-terminal.exe'; size = 15; sha256 = $SmokeSha })
    $prov = [ordered]@{ version = $Version; head = $Stamp.head; diff_sha256 = $Stamp.diff_sha256; untracked_sha256 = $Stamp.untracked_sha256; files = $files }
    [System.IO.File]::WriteAllText((Join-Path $dir 'PROVENANCE.json'), ($prov | ConvertTo-Json), $Utf8)
    Write-Sums $dir
    return $dir
}

function Write-Sums {
    param([string]$Dir)
    $prefix = $Dir.TrimEnd('\') + '\'
    $lines = foreach ($f in Get-ChildItem $Dir -Recurse -File | Where-Object { $_.Name -ne 'SHA256SUMS' }) {
        "{0} *{1}" -f (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.ToLowerInvariant(), $f.FullName.Substring($prefix.Length).Replace('\', '/')
    }
    [System.IO.File]::WriteAllText((Join-Path $Dir 'SHA256SUMS'), (($lines -join "`n") + "`n"), $Utf8)
}

$PassingCheck = Join-Path $Scratch 'artefact-pass.mjs'
$FailingCheck = Join-Path $Scratch 'artefact-fail.mjs'
[System.IO.File]::WriteAllText($PassingCheck, "process.exit(0)`n", $Utf8)
[System.IO.File]::WriteAllText($FailingCheck, "console.error('planted problem'); process.exit(1)`n", $Utf8)

function Invoke-ReleaseCheck {
    # Runs release_check.ps1 in this session with the self-test hooks; returns the exit code and the text.
    param([hashtable]$Arguments)
    $text = (& $ReleaseCheck @Arguments *>&1 | Out-String)
    $script:LastText = $text
    return @{ code = $LASTEXITCODE; text = $text }
}

function Merge-Args {
    # A copy of the arguments with some of them replaced.
    param([hashtable]$Base, [hashtable]$Over)
    $copy = $Base.Clone()
    foreach ($key in $Over.Keys) { $copy[$key] = $Over[$key] }
    return $copy
}

function New-Case {
    # A tree, matching records and a matching release folder; a case then breaks exactly one thing.
    param([string]$Name, [string]$Version = '0.1.0')
    $tree = New-Tree "$Name-tree"
    $stamp = Get-TreeStamp $tree
    $records = Join-Path $Scratch "$Name-records"
    Write-Records $records $Today $stamp
    $release = New-ReleaseDir "$Name-release" $stamp $Version
    return @{ tree = $tree; stamp = $stamp; records = $records; release = $release
        args = @{ Tag = "desktop-v$Version"; TreeRoot = $tree; RecordsDir = $records; ReleaseDir = $release; Today = $Today; Pc = $Pc; ArtefactCheckScript = $PassingCheck; DumpsDir = $DumpsFolder; DistDir = $DistFolder } }
}

function New-DirtyCase {
    # Records and artefacts that all match a tree which is NOT a clean commit: only the clean-tree rule can refuse it.
    param([string]$Name, [scriptblock]$Dirty)
    $tree = New-Tree "$Name-tree"
    & $Dirty $tree
    $stamp = Get-TreeStamp $tree
    $records = Join-Path $Scratch "$Name-records"
    Write-Records $records $Today $stamp
    $release = New-ReleaseDir "$Name-release" $stamp '0.1.0'
    return @{ tree = $tree; stamp = $stamp
        args = @{ Tag = 'desktop-v0.1.0'; TreeRoot = $tree; RecordsDir = $records; ReleaseDir = $release; Today = $Today; Pc = $Pc; ArtefactCheckScript = $PassingCheck; DumpsDir = $DumpsFolder; DistDir = $DistFolder } }
}

# ---- record_green.ps1 ------------------------------------------------------------------------------------------------

$tree = New-Tree 'rg-tree'
$stampA = Get-TreeStamp $tree
$stampB = Get-TreeStamp $tree
Check 'the stamp of an unchanged tree is stable' (($stampA | ConvertTo-Json) -eq ($stampB | ConvertTo-Json))
Check 'the stamp has HEAD and two sha256 values' (($stampA.head -match '^[0-9a-f]{40}$') -and ($stampA.diff_sha256 -match '^[0-9a-f]{64}$') -and ($stampA.untracked_sha256 -match '^[0-9a-f]{64}$'))
[System.IO.File]::WriteAllText((Join-Path $tree 'a.txt'), "two`n", $Utf8)
$stampDiff = Get-TreeStamp $tree
Check 'a tracked change moves diff_sha256 only' (($stampDiff.diff_sha256 -ne $stampA.diff_sha256) -and ($stampDiff.head -eq $stampA.head) -and ($stampDiff.untracked_sha256 -eq $stampA.untracked_sha256))
[System.IO.File]::WriteAllText((Join-Path $tree 'new.txt'), "new`n", $Utf8)
$stampNew = Get-TreeStamp $tree
Check 'an untracked file moves untracked_sha256' ($stampNew.untracked_sha256 -ne $stampDiff.untracked_sha256)
[System.IO.File]::WriteAllText((Join-Path $tree 'new.txt'), "changed`n", $Utf8)
Check 'an untracked file with other contents moves it again' ((Get-TreeStamp $tree).untracked_sha256 -ne $stampNew.untracked_sha256)

$greenTree = New-Tree 'rg-green'
$recordsDir = Join-Path $Scratch 'rg-records'
$shell = (Get-Command powershell).Source

$null = & $Record -Check backend -TreeRoot $greenTree -RecordsDir $recordsDir -Exe $shell -ExeArgs @('-NoProfile', '-Command', 'Write-Output "bad"; exit 3') *>&1
Check 'a failing check writes no record (born failing)' (($LASTEXITCODE -eq 1) -and -not (Test-Path (Join-Path $recordsDir '*')))

$null = & $Record -Check backend -TreeRoot $greenTree -RecordsDir $recordsDir -Exe $shell -ExeArgs @('-NoProfile', '-Command', "Set-Content -Path '$greenTree\drift.txt' -Value x; exit 0") *>&1
Check 'a check that changes the tree while it runs writes no record (born failing)' (($LASTEXITCODE -eq 1) -and -not (Test-Path (Join-Path $recordsDir '*')))
Remove-Item -LiteralPath (Join-Path $greenTree 'drift.txt') -Force

$null = & $Record -Check backend -TreeRoot $greenTree -RecordsDir $recordsDir -Exe $shell -ExeArgs @('-NoProfile', '-Command', "Write-Output '12 passed, 3 skipped in 1.2s'; exit 0") *>&1
$file = Join-Path $recordsDir ((Get-Date).ToString('yyyy-MM-dd') + '_backend.json')
Check 'a passing check writes <date>_<check>.json' (($LASTEXITCODE -eq 0) -and (Test-Path $file))
if (Test-Path $file) {
    $rec = Get-Content -Raw $file | ConvertFrom-Json
    $now = Get-TreeStamp $greenTree
    Check 'the record holds date, this PC, exit code 0 and the counts' (($rec.date -eq (Get-Date).ToString('yyyy-MM-dd')) -and ($rec.pc -eq $env:COMPUTERNAME) -and ($rec.exit_code -eq 0) -and ($rec.counts.passed -eq 12) -and ($rec.counts.skipped -eq 3))
    Check 'the record carries the tree stamp' (($rec.stamp.head -eq $now.head) -and ($rec.stamp.diff_sha256 -eq $now.diff_sha256) -and ($rec.stamp.untracked_sha256 -eq $now.untracked_sha256))
}
Check 'the records folder is the only thing written' (@(Get-ChildItem $greenTree -Force | Where-Object { $_.Name -notin '.git', '.nohooks', 'a.txt' }).Count -eq 0)
if (Test-Path $file) {
    Check 'a record written through the -Exe hook is marked self_test (born failing)' ($rec.self_test -eq $true)
    Check 'and still names the check''s canonical command, not the hook program' (($rec.command -match 'pytest') -and ($rec.command -notmatch 'powershell'))
}

# -Exe or -TreeRoot with the default records folder must be refused, and must write nothing there. The real folder is
# snapshotted and restored, so a failure of this very guard cannot leave a forged record behind.
$realRecords = Join-Path (Split-Path $Scripts -Parent) 'state\release'
$realFile = Join-Path $realRecords ((Get-Date).ToString('yyyy-MM-dd') + '_backend.json')
$realBefore = if (Test-Path -LiteralPath $realFile) { [System.IO.File]::ReadAllBytes($realFile) } else { $null }
$null = & $Record -Check backend -TreeRoot $greenTree -Exe $shell -ExeArgs @('-NoProfile', '-Command', 'exit 0') *>&1
$refusedCode = $LASTEXITCODE
$realAfter = if (Test-Path -LiteralPath $realFile) { [System.IO.File]::ReadAllBytes($realFile) } else { $null }
$untouched = ($null -eq $realBefore -and $null -eq $realAfter) -or ($null -ne $realBefore -and $null -ne $realAfter -and [System.Linq.Enumerable]::SequenceEqual([byte[]]$realBefore, [byte[]]$realAfter))
if (-not $untouched) {
    if ($null -eq $realBefore) { Remove-Item -LiteralPath $realFile -Force } else { [System.IO.File]::WriteAllBytes($realFile, [byte[]]$realBefore) }
}
Check 'a self-test hook with the default records folder is refused and writes nothing (born failing)' (($refusedCode -eq 2) -and $untouched)

# -Lab changes which program runs, so it is a self-test hook too: a stub at <lab>\.venv\Scripts\python.exe must leave a
# self_test record (which release_check.ps1 refuses), and without an explicit -RecordsDir it must be refused outright.
$stubLab = Join-Path $Scratch 'stub-lab'
New-Item -ItemType Directory -Force -Path (Join-Path $stubLab '.venv\Scripts') | Out-Null
Add-Type -TypeDefinition 'public static class StubPython { public static int Main() { return 0; } }' -OutputAssembly (Join-Path $stubLab '.venv\Scripts\python.exe') -OutputType ConsoleApplication   # a do-nothing exe that exits 0
$labRecords = Join-Path $Scratch 'rg-lab-records'
$null = & $Record -Check backend -Lab $stubLab -RecordsDir $labRecords *>&1
$labFile = Join-Path $labRecords ((Get-Date).ToString('yyyy-MM-dd') + '_backend.json')
$labRec = if (Test-Path -LiteralPath $labFile) { Get-Content -Raw $labFile | ConvertFrom-Json } else { $null }
Check 'a record made with -Lab pointing at a stub is marked self_test (born failing)' (($null -ne $labRec) -and ($labRec.self_test -eq $true))

$labBefore = if (Test-Path -LiteralPath $realFile) { [System.IO.File]::ReadAllBytes($realFile) } else { $null }
$null = & $Record -Check backend -Lab $stubLab *>&1
$labRefusedCode = $LASTEXITCODE
$labAfter = if (Test-Path -LiteralPath $realFile) { [System.IO.File]::ReadAllBytes($realFile) } else { $null }
$labUntouched = ($null -eq $labBefore -and $null -eq $labAfter) -or ($null -ne $labBefore -and $null -ne $labAfter -and [System.Linq.Enumerable]::SequenceEqual([byte[]]$labBefore, [byte[]]$labAfter))
if (-not $labUntouched) {
    if ($null -eq $labBefore) { Remove-Item -LiteralPath $realFile -Force } else { [System.IO.File]::WriteAllBytes($realFile, [byte[]]$labBefore) }
}
Check '-Lab with the default records folder is refused and writes nothing (born failing)' (($labRefusedCode -eq 2) -and $labUntouched)

# The backend check runs pytest in parallel (-n 16 --dist loadfile) only when the venv can import xdist, and falls
# back to the serial command otherwise. Two stub pythons log their arguments; the stub without xdist fails the probe
# (-c "import xdist"). The record keeps naming the serial canonical command in both cases (release_check compares it).
function New-ArgLogLab {
    param([string]$Name, [bool]$HasXdist)
    $lab = Join-Path $Scratch $Name
    New-Item -ItemType Directory -Force -Path (Join-Path $lab '.venv\Scripts') | Out-Null
    $failProbe = if ($HasXdist) { 'false' } else { 'true' }
    $source = 'public static class ArgLogPython { public static int Main(string[] a) { if (a.Length > 0 && a[0] == "-c") return ' + $failProbe + ' ? 1 : 0; System.IO.File.AppendAllText(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location), "args.log"), string.Join(" ", a) + "\n"); return 0; } }'
    Add-Type -TypeDefinition $source -OutputAssembly (Join-Path $lab '.venv\Scripts\python.exe') -OutputType ConsoleApplication
    return $lab
}
foreach ($variant in @(@{ name = 'xdist'; has = $true }, @{ name = 'serial'; has = $false })) {
    $argLab = New-ArgLogLab ("arglog-" + $variant.name) $variant.has
    $argRecords = Join-Path $Scratch ("rg-arglog-" + $variant.name)
    $null = & $Record -Check backend -Lab $argLab -RecordsDir $argRecords *>&1
    $logFile = Join-Path $argLab '.venv\Scripts\args.log'
    $logged = if (Test-Path -LiteralPath $logFile) { (Get-Content -Raw -LiteralPath $logFile) } else { '' }
    $tests = '-q ' + (Join-Path (Split-Path $Scripts -Parent) 'backend\tests')
    $recFile = Join-Path $argRecords ((Get-Date).ToString('yyyy-MM-dd') + '_backend.json')
    $recText = if (Test-Path -LiteralPath $recFile) { Get-Content -Raw -LiteralPath $recFile } else { '' }
    if ($variant.has) {
        Check 'the backend check adds -n 16 --dist loadfile when the venv imports xdist (born failing)' (($logged -match '-o addopts= -q -n 16 --dist loadfile ') -and ($logged -match [regex]::Escape('backend\tests')))
        Check 'the xdist run records the serial canonical command' (($recText -match [regex]::Escape('-o addopts= -q ')) -and ($recText -notmatch '--dist'))
    } else {
        Check 'the backend check falls back to the serial command without xdist (born failing)' (($logged -match [regex]::Escape('-o addopts= ' + $tests)) -and ($logged -notmatch '-n 16') -and ($logged -notmatch '--dist'))
    }
}

# ---- release_check.ps1 -----------------------------------------------------------------------------------------------

$case = New-Case 'ok'
$ok = Invoke-ReleaseCheck $case.args
Check 'the clean case passes (same day, same PC, same stamp, artefacts of this tree)' ($ok.code -eq 0) $ok.text
Check 'it says the owner tags, not the script' ($ok.text -match 'may be tagged by the owner')
Check 'it created no tag' (@(& git -C $case.tree tag -l).Count -eq 0)
Check 'it prints the HEAD that would be tagged' ($ok.text -match ('HEAD to be tagged: ' + $case.stamp.head))

$case = New-DirtyCase 'dirty-tracked' { param($t) [System.IO.File]::WriteAllText((Join-Path $t 'a.txt'), "edited, not committed`n", $Utf8) }
$r = Invoke-ReleaseCheck $case.args
Check 'a tracked change not yet committed is refused although records and artefacts match it (born failing)' (($r.code -eq 1) -and ($r.text -match 'clean tree') -and (($r.text -replace '\s+','') -match 'commitfirst,thenrecordandbuildfromthecleancommit'))

$case = New-DirtyCase 'dirty-untracked' { param($t) [System.IO.File]::WriteAllText((Join-Path $t 'new.txt'), "not added`n", $Utf8) }
$r = Invoke-ReleaseCheck $case.args
Check 'an untracked file is refused although records and artefacts match it (born failing)' (($r.code -eq 1) -and ($r.text -match 'clean tree') -and (($r.text -replace '\s+','') -match 'commitfirst,thenrecordandbuildfromthecleancommit'))

$case = New-Case 'yesterday'
Remove-Item (Join-Path $case.records "${Today}_backend.json")
Write-RecordFile $case.records $Yesterday 'backend' $case.stamp
$r = Invoke-ReleaseCheck $case.args
Check 'a record from the day before is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'record backend') -and ($r.text -match 'no record'))

$case = New-Case 'yesterday-in-file'
$body = Get-Content -Raw (Join-Path $case.records "${Today}_smoke.json") | ConvertFrom-Json
$body.date = $Yesterday
[System.IO.File]::WriteAllText((Join-Path $case.records "${Today}_smoke.json"), ($body | ConvertTo-Json -Depth 5), $Utf8)
$r = Invoke-ReleaseCheck $case.args
Check 'a record renamed to today but dated the day before inside is refused' (($r.code -eq 1) -and ($r.text -match 'dated 2026-10-02'))

$case = New-Case 'stamp'
$other = [pscustomobject]@{ head = $case.stamp.head; diff_sha256 = ('0' * 64); untracked_sha256 = $case.stamp.untracked_sha256 }
Write-RecordFile $case.records $Today 'crosscheck' $other
$r = Invoke-ReleaseCheck $case.args
Check 'a record with a different stamp is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'diff_sha256 differs'))

$case = New-Case 'tree-moved'
[System.IO.File]::WriteAllText((Join-Path $case.tree 'a.txt'), "edited after the records`n", $Utf8)
$r = Invoke-ReleaseCheck $case.args
Check 'a tree edited after the records were written is refused' (($r.code -eq 1) -and ($r.text -match 'diff_sha256 differs'))

$case = New-Case 'other-pc'
Write-RecordFile $case.records $Today 'backend' $case.stamp 'OTHER-PC'
$r = Invoke-ReleaseCheck $case.args
Check 'a record from another PC is refused' (($r.code -eq 1) -and ($r.text -match "PC 'OTHER-PC'"))

$case = New-Case 'exit-code'
Write-RecordFile $case.records $Today 'smoke' $case.stamp $Pc 1
$r = Invoke-ReleaseCheck $case.args
Check 'a record with a failing exit code is refused' (($r.code -eq 1) -and ($r.text -match 'exit code is 1'))

$case = New-Case 'missing'
Remove-Item (Join-Path $case.records "${Today}_crosscheck.json")
$r = Invoke-ReleaseCheck $case.args
Check 'a missing record is refused' (($r.code -eq 1) -and ($r.text -match 'record crosscheck'))

$case = New-Case 'forged'
[System.IO.File]::WriteAllText((Join-Path $case.records "${Today}_backend.json"), '{ "check": "backend" }', $Utf8)
$r = Invoke-ReleaseCheck $case.args
Check 'a partial record is refused, not a crash' (($r.code -eq 1) -and ($r.text -match 'record backend'))

$case = New-Case 'app'
$a = $case.args.Clone(); $a['RequireSmokeApp'] = $true
Remove-Item (Join-Path $case.records "${Today}_smoke-app.json")
$r = Invoke-ReleaseCheck $a
Check 'smoke-app is required with -RequireSmokeApp' (($r.code -eq 1) -and ($r.text -match 'record smoke-app'))
$appNow = Get-InputsJson
Write-InputRecord $case.records $Today 'smoke-app' $case.stamp ([pscustomobject]@{ smoke_exe = $appNow.smoke_exe; web_dist = $appNow.web_dist })
Check 'and accepted when its record is current' ((Invoke-ReleaseCheck $a).code -eq 0)

$case = New-Case 'hook-record'
$null = & $Record -Check backend -TreeRoot $case.tree -RecordsDir $case.records -Exe $shell -ExeArgs @('-NoProfile', '-Command', 'exit 0') *>&1
$forged = Join-Path $case.records ((Get-Date).ToString('yyyy-MM-dd') + '_backend.json')
$forgedBody = Get-Content -Raw $forged | ConvertFrom-Json
$forgedBody.date = $Today; $forgedBody.pc = $Pc
[System.IO.File]::WriteAllText((Join-Path $case.records "${Today}_backend.json"), ($forgedBody | ConvertTo-Json -Depth 6), $Utf8)
$r = Invoke-ReleaseCheck $case.args
Check 'a record written through the -Exe hook is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'record backend') -and ($r.text -match 'self-test'))

$case = New-Case 'self-test-flag'
Write-RecordFile $case.records $Today 'backend' $case.stamp $Pc 0 '' $true
$r = Invoke-ReleaseCheck $case.args
Check 'a record flagged self_test is refused' (($r.code -eq 1) -and ($r.text -match 'self-test'))

$case = New-Case 'other-command'
Write-RecordFile $case.records $Today 'smoke' $case.stamp $Pc 0 'cmd.exe /c exit 0'
$r = Invoke-ReleaseCheck $case.args
Check 'a record whose command is not the check''s own is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'command'))

$case = New-Case 'other-lab-command'
$otherLabCommand = (Get-CanonicalCommand 'backend').Replace((Split-Path (Split-Path $Scripts -Parent) -Parent) + '\.venv', 'D:\elsewhere\.venv')
Write-RecordFile $case.records $Today 'backend' $case.stamp $Pc 0 $otherLabCommand
$r = Invoke-ReleaseCheck $case.args
Check 'a backend record that names another lab''s python is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'not the command of the backend check'))

$case = New-Case 'other-terminal-command'
Write-RecordFile $case.records $Today 'backend' $case.stamp $Pc 0 ((Get-CanonicalCommand 'backend').Replace('\backend\tests', '\x\backend\tests'))
$r = Invoke-ReleaseCheck $case.args
Check 'a backend record that names another test folder is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'not the command of the backend check'))

$case = New-Case 'no-command'
$bare = [ordered]@{ check = 'backend'; date = $Today; pc = $Pc; exit_code = 0; counts = @{}; stamp = $case.stamp }
[System.IO.File]::WriteAllText((Join-Path $case.records "${Today}_backend.json"), ($bare | ConvertTo-Json -Depth 6), $Utf8)
$r = Invoke-ReleaseCheck $case.args
Check 'a hand-written record without command and self_test is refused' (($r.code -eq 1) -and ($r.text -match 'record backend'))

Check 'the records and release folder hooks print the not-a-release-check WARN' ($ok.text -match 'WARN' -and $ok.text -match 'RecordsDir' -and $ok.text -match 'ReleaseDir')

$case = New-Case 'provenance'
$prov = Get-Content -Raw (Join-Path $case.release 'PROVENANCE.json') | ConvertFrom-Json
$prov.head = ('1' * 40)
[System.IO.File]::WriteAllText((Join-Path $case.release 'PROVENANCE.json'), ($prov | ConvertTo-Json), $Utf8)
Write-Sums $case.release
$r = Invoke-ReleaseCheck $case.args
Check 'artefacts built from another commit are refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'artefact provenance') -and ($r.text -match 'head differs'))

$case = New-Case 'version'
$r = Invoke-ReleaseCheck (Merge-Args $case.args @{ Tag = 'desktop-v0.2.0' })
Check 'artefacts of another version than the tag are refused' (($r.code -eq 1) -and ($r.text -match 'version 0.1.0, the tag is 0.2.0'))

$case = New-Case 'sums'
[System.IO.File]::WriteAllText((Join-Path $case.release 'payload\a.bin'), 'tampered', $Utf8)
$r = Invoke-ReleaseCheck $case.args
Check 'an artefact changed after SHA256SUMS was written is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'does not match its hash'))

$case = New-Case 'extra'
[System.IO.File]::WriteAllText((Join-Path $case.release 'payload\extra.bin'), 'not listed', $Utf8)
$r = Invoke-ReleaseCheck $case.args
Check 'a file that SHA256SUMS does not list is refused' (($r.code -eq 1) -and ($r.text -match 'extra.bin is not listed'))

$case = New-Case 'artefact-check'
$r = Invoke-ReleaseCheck (Merge-Args $case.args @{ ArtefactCheckScript = $FailingCheck })
Check 'a failing artefact check is refused' (($r.code -eq 1) -and ($r.text -match 'artefact check'))

$case = New-Case 'tag-format'
$r = Invoke-ReleaseCheck (Merge-Args $case.args @{ Tag = 'v0.1.0' })
Check 'a tag that is not desktop-vX.Y.Z is refused' (($r.code -eq 1) -and ($r.text -match 'not desktop-vX.Y.Z'))

$case = New-Case 'tag-exists'
$ErrorActionPreference = 'Continue'
& git -C $case.tree tag desktop-v0.1.0
$ErrorActionPreference = 'Stop'
$r = Invoke-ReleaseCheck $case.args
Check 'a tag that already exists is refused' (($r.code -eq 1) -and ($r.text -match 'already exists'))

$case = New-Case 'no-artefacts'
Remove-Item -Recurse -Force $case.release
$r = Invoke-ReleaseCheck $case.args
Check 'a missing release folder is refused' (($r.code -eq 1) -and ($r.text -match 'artefact provenance'))

# ---- inputs outside the tree stamp: the smoke exe, web\dist and the QA dumps ------------------------------------------

$now = Get-InputsJson
Check 'record_green -Inputs reports the smoke exe path and sha256' (($now.smoke_exe.path -eq $SmokeExeFile) -and ($now.smoke_exe.sha256 -eq (Get-FileHash -Algorithm SHA256 -LiteralPath $SmokeExeFile).Hash.ToLowerInvariant()))
Check 'it reports the dist sha256 and file count, and the dump sha256, count and newest mtime' (($now.web_dist.sha256 -match '^[0-9a-f]{64}$') -and ($now.web_dist.count -eq 2) -and ($now.dumps.sha256 -match '^[0-9a-f]{64}$') -and ($now.dumps.count -eq 1) -and $now.dumps.newest_mtime_utc)
$distCopy = Join-Path $Scratch 'dist-copy'
Copy-Item -Recurse -LiteralPath $DistFolder -Destination $distCopy
[System.IO.File]::WriteAllText((Join-Path $distCopy 'assets\app.js'), 'console.log(2)', $Utf8)
Check 'a changed dist asset moves the dist sha256' ((Get-InputsJson -Dist $distCopy).web_dist.sha256 -ne $now.web_dist.sha256)
$dumpsCopy = Join-Path $Scratch 'dumps-copy'
Copy-Item -Recurse -LiteralPath $DumpsFolder -Destination $dumpsCopy
[System.IO.File]::WriteAllText((Join-Path $dumpsCopy 'nqt_a.json'), '{"a":2}', $Utf8)
Check 'a changed dump moves the dump sha256' ((Get-InputsJson -Dumps $dumpsCopy).dumps.sha256 -ne $now.dumps.sha256)

$inTree = New-Tree 'inputs-tree'
$inRecords = Join-Path $Scratch 'inputs-records'
$hooks = @{ SmokeExe = $SmokeExeFile; DistDir = $distCopy; DumpsDir = $dumpsCopy }
$null = & $Record -Check crosscheck -TreeRoot $inTree -RecordsDir $inRecords -Exe $shell -ExeArgs @('-NoProfile', '-Command', 'exit 0') @hooks *>&1
$inFile = Join-Path $inRecords ((Get-Date).ToString('yyyy-MM-dd') + '_crosscheck.json')
Check 'a passing crosscheck record carries the inputs and the start of the run (born failing)' ((Test-Path $inFile) -and ((Get-Content -Raw $inFile | ConvertFrom-Json).inputs.smoke_exe.sha256 -eq $now.smoke_exe.sha256) -and ((Get-Content -Raw $inFile | ConvertFrom-Json).inputs.web_dist.sha256 -ne $now.web_dist.sha256) -and (Get-Content -Raw $inFile | ConvertFrom-Json).started_utc)
Remove-Item -LiteralPath $inRecords -Recurse -Force -ErrorAction SilentlyContinue
$null = & $Record -Check crosscheck -TreeRoot $inTree -RecordsDir $inRecords -Exe $shell -ExeArgs @('-NoProfile', '-Command', "Set-Content -Path '$distCopy\assets\app.js' -Value changed; exit 0") @hooks *>&1
Check 'a check that changes web\dist while it runs writes no record (born failing)' (($LASTEXITCODE -eq 1) -and -not (Test-Path $inFile))

# The exe a record names must be the exe the check launches: -SmokeExe is exported to the check as NQT_SMOKE_EXE (the
# variable smoke_real.ps1 -Mode App and the desktop Playwright project read), over an NQT_SMOKE_EXE already set.
$otherExe = Join-Path $Scratch 'other-smoke.exe'
[System.IO.File]::WriteAllText($otherExe, 'another build', $Utf8)
$probe = Join-Path $Scratch 'launched-exe.txt'
$probeRecords = Join-Path $Scratch 'probe-records'
$envBefore = $env:NQT_SMOKE_EXE
$env:NQT_SMOKE_EXE = $otherExe
$null = & $Record -Check crosscheck -TreeRoot $inTree -RecordsDir $probeRecords -Exe $shell -ExeArgs @('-NoProfile', '-Command', "[System.IO.File]::WriteAllText('$probe', [string]`$env:NQT_SMOKE_EXE); exit 0") @hooks *>&1
$envAfter = $env:NQT_SMOKE_EXE
$env:NQT_SMOKE_EXE = $envBefore
$launched = if (Test-Path -LiteralPath $probe) { [System.IO.File]::ReadAllText($probe) } else { '' }
$probeFile = Join-Path $probeRecords ((Get-Date).ToString('yyyy-MM-dd') + '_crosscheck.json')
$probeRec = if (Test-Path -LiteralPath $probeFile) { Get-Content -Raw $probeFile | ConvertFrom-Json } else { $null }
Check '-SmokeExe is the exe the check launches, not a different NQT_SMOKE_EXE (born failing)' ($launched -eq $SmokeExeFile)
Check 'the record names the exe that was launched' (($null -ne $probeRec) -and ($probeRec.inputs.smoke_exe.path -eq $launched))
Check 'record_green leaves the caller''s NQT_SMOKE_EXE as it found it' ($envAfter -eq $otherExe)

$case = New-Case 'no-inputs'
Write-InputRecord $case.records $Today 'crosscheck' $case.stamp
$r = Invoke-ReleaseCheck $case.args
Check 'a crosscheck record with no inputs block is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'record inputs crosscheck') -and ($r.text -match 'no inputs'))

$case = New-Case 'old-exe'
$otherSha = ('a' * 64)
$release2 = New-ReleaseDir 'old-exe-release2' $case.stamp '0.1.0' $otherSha
$r = Invoke-ReleaseCheck (Merge-Args $case.args @{ ReleaseDir = $release2 })
Check 'a smoke exe that is not the release folder''s payload\smoke exe is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'record inputs crosscheck') -and ($r.text -match 'smoke exe'))

$case = New-Case 'stale-dist'
$r = Invoke-ReleaseCheck (Merge-Args $case.args @{ DistDir = $distCopy })
Check 'a web\dist that differs from the one the record used is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'web.dist'))

$case = New-Case 'stale-dumps'
$r = Invoke-ReleaseCheck (Merge-Args $case.args @{ DumpsDir = $dumpsCopy })
Check 'dumps that differ from the ones the record used are refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'dumps'))

$oldDumps = Join-Path $Scratch 'dumps-old'
New-Item -ItemType Directory -Force -Path $oldDumps | Out-Null
[System.IO.File]::WriteAllText((Join-Path $oldDumps 'nqt_a.json'), '{"a":1}', $Utf8)
[System.IO.File]::SetLastWriteTimeUtc((Join-Path $oldDumps 'nqt_a.json'), (Get-Date).ToUniversalTime().AddDays(-1))
$case = New-Case 'old-dumps'
Write-InputRecord $case.records $Today 'crosscheck' $case.stamp (Get-InputsJson -Dumps $oldDumps)
$r = Invoke-ReleaseCheck (Merge-Args $case.args @{ DumpsDir = $oldDumps })
Check 'dumps older than the start of the backend run are refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'older than'))

$case = New-Case 'app-exe'
$a = Merge-Args $case.args @{ RequireSmokeApp = $true }
$appBad = [pscustomobject]@{ smoke_exe = [pscustomobject]@{ path = 'x.exe'; sha256 = $otherSha }; web_dist = $now.web_dist }
Write-InputRecord $case.records $Today 'smoke-app' $case.stamp $appBad
$r = Invoke-ReleaseCheck $a
Check 'a smoke-app record made with another smoke exe is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'record inputs smoke-app') -and ($r.text -match 'smoke exe'))

$case = New-Case 'no-smoke-payload'
$prov = Get-Content -Raw (Join-Path $case.release 'PROVENANCE.json') | ConvertFrom-Json
$prov.files = @()
[System.IO.File]::WriteAllText((Join-Path $case.release 'PROVENANCE.json'), ($prov | ConvertTo-Json -Depth 4), $Utf8)
Write-Sums $case.release
$r = Invoke-ReleaseCheck $case.args
Check 'a release folder that lists no smoke payload cannot vouch for the smoke exe' (($r.code -eq 1) -and ($r.text -match 'smoke exe'))

# ---- summary ---------------------------------------------------------------------------------------------------------

if ($Scratch.StartsWith('D:dev	mpw5a-package-tests')) { Remove-Item -Recurse -Force $Scratch -ErrorAction SilentlyContinue }
Write-Host ''
Write-Host ("release_check tests: {0} passed, {1} failed" -f $Passed, $Failed.Count)
if ($Failed.Count -gt 0) { Write-Host ("FAILED: " + ($Failed -join '; ')); exit 1 }
exit 0
