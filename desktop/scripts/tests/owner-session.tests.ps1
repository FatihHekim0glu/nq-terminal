# Born-failing tests of desktop\scripts\owner-session.ps1 as a command.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\tests\owner-session.tests.ps1
#
# The script is run as the owner would run it, in a child PowerShell, over a fixture session list and three fixture
# templates (desktop\scripts\tests\fixtures\owner-session\). Records go to a scratch folder under D:\dev\tmp\v04-w0 that
# the script accepts as its checks folder only because it sits under D:\dev\tmp (the test hook). The release tag is the
# real, existing tag desktop-v0.3.2 (a read-only rev-parse), the installer sums are the fixture file, and the uninstall
# entry is a fake registry root (HKCU\Software\nqt-owner-session-tests-<id>). Nothing in the real docs\desktop\checks
# folder may change; the last cases compare its listing before and after.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Script = (Resolve-Path (Join-Path $PSScriptRoot '..\owner-session.ps1')).Path
$Terminal = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Fixtures = Join-Path $PSScriptRoot 'fixtures\owner-session'
$Id = [guid]::NewGuid().ToString('N').Substring(0, 8)
$ScratchRoot = 'D:\dev\tmp\v04-w0'
$Scratch = Join-Path $ScratchRoot "owner-session-tests-$Id"
$FakeRoot = "Registry::HKEY_CURRENT_USER\Software\nqt-owner-session-tests-$Id"
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$TagVersion = '0.3.2'
$TestDate = '2026-11-02'
$FixtureSha = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
$RealChecks = Join-Path $Terminal 'docs\desktop\checks'
$Passed = 0
$Failed = New-Object System.Collections.Generic.List[string]

function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:Passed++; Write-Host "PASS  $Name" } else { $Failed.Add($Name); Write-Host "FAIL  $Name  $Detail" }
}

function Invoke-Session {
    # The script in a child PowerShell (it calls exit); returns the exit code and the text.
    param([string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $text = (& powershell -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments 2>&1 | Out-String)
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    return @{ code = $code; text = $text }
}

function New-Case {
    # A fresh checks folder holding the fixture templates; returns its path.
    param([string]$Name)
    $dir = Join-Path $Scratch "$Name\checks"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item -Path (Join-Path $Fixtures 'checks\*.md') -Destination $dir
    return $dir
}

function Get-BaseArguments {
    # The usual arguments; each one can be replaced here (a repeated switch would be a binding error). Sums 'NONE' leaves -Sums out.
    param([string]$ChecksDir, [string]$OrderFile = (Join-Path $Fixtures 'session_order.json'), [string]$Version = $TagVersion,
        [string]$Date = $TestDate, [string]$SumsFile = (Join-Path $Scratch 'rel\0.3.2\SHA256SUMS'), [string]$Releases = (Join-Path $Scratch 'rel'),
        [string]$UninstallSub = 'Uninstall')
    $list = @('-Version', $Version, '-Order', $OrderFile, '-ChecksDir', $ChecksDir, '-Date', $Date, '-UninstallRoot', "$FakeRoot\$UninstallSub", '-ReleaseRoot', $Releases)
    if ($SumsFile -ne 'NONE') { $list += @('-Sums', $SumsFile) }
    return $list
}

function Get-StepChecks {
    # The check names of the STEP lines, in the order printed.
    param([string]$Text)
    return @([regex]::Matches($Text, '(?m)^STEP \d+ of \d+: (\S+)\s*$') | ForEach-Object { $_.Groups[1].Value })
}

function Test-SameList {
    param([string[]]$Left, [string[]]$Right)
    return (($Left -join '|') -eq ($Right -join '|'))
}

function Get-Listing {
    param([string]$Folder)
    return @(Get-ChildItem -LiteralPath $Folder -Force -Recurse | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" })
}

function Write-OrderFile {
    # A session list written to a case folder: entries are check and template pairs.
    param([string]$Case, [object[]]$Steps)
    $file = Join-Path $Scratch "$Case\order.json"
    $json = ConvertTo-Json -Depth 5 -InputObject @{ schema = 1; steps = @($Steps) }
    [System.IO.File]::WriteAllText($file, $json, $Utf8)
    return $file
}

New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$releaseDir = Join-Path $Scratch 'rel\0.3.2'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Copy-Item -Path (Join-Path $Fixtures 'SHA256SUMS') -Destination $releaseDir
[System.IO.File]::WriteAllBytes((Join-Path $releaseDir 'nq-lab terminal_0.3.2_x64-setup.exe'), (New-Object byte[] 12345))
$FakeApp = Join-Path $Scratch 'app'
New-Item -Path "$FakeRoot\Uninstall\nq-lab terminal" -Force | Out-Null
New-ItemProperty -LiteralPath "$FakeRoot\Uninstall\nq-lab terminal" -Name 'InstallLocation' -Value "`"$FakeApp`"" -PropertyType String | Out-Null
New-ItemProperty -LiteralPath "$FakeRoot\Uninstall\nq-lab terminal" -Name 'DisplayVersion' -Value '0.3.2' -PropertyType String | Out-Null
# An older install (0.3.1) and an install whose entry has no DisplayVersion, for the version-mismatch cases.
New-Item -Path "$FakeRoot\UninstallOld\nq-lab terminal" -Force | Out-Null
New-ItemProperty -LiteralPath "$FakeRoot\UninstallOld\nq-lab terminal" -Name 'InstallLocation' -Value "`"$FakeApp`"" -PropertyType String | Out-Null
New-ItemProperty -LiteralPath "$FakeRoot\UninstallOld\nq-lab terminal" -Name 'DisplayVersion' -Value '0.3.1' -PropertyType String | Out-Null
New-Item -Path "$FakeRoot\UninstallNoVersion\nq-lab terminal" -Force | Out-Null
New-ItemProperty -LiteralPath "$FakeRoot\UninstallNoVersion\nq-lab terminal" -Name 'InstallLocation' -Value "`"$FakeApp`"" -PropertyType String | Out-Null

$wantedChecks = @('real-keyboard', 'nvda', 'minimised-close')
$tagCommit = (& git -C $Terminal rev-parse --verify --quiet "refs/tags/desktop-v$TagVersion^{commit}")
try {
    Check "the fixture tag desktop-v$TagVersion exists in this repository" (($LASTEXITCODE -eq 0) -and ($tagCommit -match '^[0-9a-f]{40}$')) "$tagCommit"

    # ---- the script never launches, closes or contacts anything ----------------------------------------------------------
    $source = [System.IO.File]::ReadAllText($Script, $Utf8)
    $forbidden = '(?i)Start-Process|Stop-Process|Invoke-WebRequest|Invoke-RestMethod|taskkill|close-app|8765|Test-NetConnection|TcpClient|\bssh\b|WinSCP'
    Check 'the script text names no process start or stop, close script, network call or the lab port' ($source -notmatch $forbidden) ([regex]::Match($source, $forbidden).Value)
    Check 'the forbidden-token scan can fail: a planted Stop-Process line is caught (born failing)' (('Stop-Process -Id 1' -match $forbidden) -and ('& close-app.ps1' -match $forbidden))
    Check 'the script is under 800 lines' (@($source -split "`n").Count -lt 800)

    # ---- -DryRun prints exactly the steps of the list, in order ---------------------------------------------------------
    $case = New-Case 'dry'
    $r = Invoke-Session ((Get-BaseArguments $case) + @('-DryRun'))
    $steps = Get-StepChecks $r.text
    Check '-DryRun over the fixture list exits 0' ($r.code -eq 0) $r.text
    Check '-DryRun prints exactly the fixture steps, in order' (Test-SameList $steps $wantedChecks) ($steps -join ',')
    Check '-DryRun counts the steps in each header and the total owner time' (($r.text -match 'STEP 3 of 3: minimised-close') -and ($r.text -match '3 steps') -and ($r.text -match '45 minutes')) $r.text
    Check '-DryRun prints the purpose, the owner time and the template commands of a step' (($r.text -match 'Press the sixteen keys on a real keyboard') -and ($r.text -match 'Owner time: 15 minutes') -and ($r.text -match 'shell\.log'))
    Check '-DryRun stops the purpose at the end of its paragraph' ($r.text -notmatch 'Another paragraph that is not part')
    Check '-DryRun writes nothing: the checks folder still holds only the three templates' (@(Get-ChildItem -LiteralPath $case).Count -eq 3)
    $removed = Write-OrderFile 'dry' @(
        @{ check = 'real-keyboard'; template = '2026-10-03_real-keyboard.md'; minutes = 15 },
        @{ check = 'minimised-close'; template = '2026-10-11_minimised-close.md'; minutes = 10 })
    $r2 = Invoke-Session ((Get-BaseArguments $case $removed) + @('-DryRun'))
    Check 'a list with one step removed fails the comparison with the fixture list (born failing)' (-not (Test-SameList (Get-StepChecks $r2.text) $wantedChecks))
    Check 'the step count follows the list it is given, not a fixed number' (($r2.text -match 'STEP 2 of 2:') -and ($r2.text -notmatch 'STEP 3 of'))
    $r3 = Invoke-Session ((Get-BaseArguments $case) + @('-DryRun', '-Only', 'minimised-close,real-keyboard'))
    Check '-Only keeps the order of the list and drops the others' (Test-SameList (Get-StepChecks $r3.text) @('real-keyboard', 'minimised-close'))
    $r4 = Invoke-Session ((Get-BaseArguments $case) + @('-DryRun', '-Only', 'no-such-check'))
    Check '-Only with a name that is not in the list is refused with exit code 2 (born failing)' (($r4.code -eq 2) -and ($r4.text -match 'no-such-check'))
    $r5 = Invoke-Session ((Get-BaseArguments $case -Version '9.9.9') + @('-DryRun'))
    Check '-DryRun with a version that has no tag still prints the steps and warns about the tag' (($r5.code -eq 0) -and ($r5.text -match 'WARN  .*desktop-v9\.9\.9') -and (Test-SameList (Get-StepChecks $r5.text) $wantedChecks)) $r5.text

    # ---- a real run writes pre-filled records ----------------------------------------------------------------------------
    $case = New-Case 'run'
    $r = Invoke-Session (Get-BaseArguments $case)
    Check 'a run over the fixture list exits 0' ($r.code -eq 0) $r.text
    $written = @(Get-ChildItem -LiteralPath $case -Filter "${TestDate}_*.md" | ForEach-Object { $_.Name } | Sort-Object)
    Check 'it writes one dated record per step beside the templates' (Test-SameList $written @("${TestDate}_minimised-close.md", "${TestDate}_nvda.md", "${TestDate}_real-keyboard.md")) ($written -join ',')
    $keyboard = [System.IO.File]::ReadAllText((Join-Path $case "${TestDate}_real-keyboard.md"), $Utf8)
    Check 'the record names the version, the tag and the release commit' (($keyboard -match "desktop-v$TagVersion") -and ($keyboard.Contains($tagCommit)))
    Check 'the installer SHA-256 row holds the hash of the installer from the sums (not the installtest or measure line)' ($keyboard -match "(?m)^\| Installer SHA-256 \| $FixtureSha \|")
    Check 'the run date row holds the date' ($keyboard -match "(?m)^\| Run date \| $TestDate \|")
    Check 'the fill-in phrase is gone and the other text of the template is unchanged' (($keyboard -notmatch 'owner-session\.ps1 fills this') -and ($keyboard -match '(?m)^PASS when 16 of 16 keys work\. Keep this line exactly\.$') -and ($keyboard -match '(?m)^\| Keyboard \(make, layout\) \| \|$'))
    Check 'the braced fill-in markers are replaced without their braces: tag and commit, file name, size, executable, release folder' (($keyboard -match "(?m)^\| Installed tag and release commit \| desktop-v$TagVersion at $tagCommit \|") -and ($keyboard -match '(?m)^\| Installer file \| nq-lab terminal_0\.3\.2_x64-setup\.exe \|') -and ($keyboard -match '(?m)^\| Installer size \(bytes\) \| 12,345 \|') -and ($keyboard.Contains((Join-Path $FakeApp 'nq-lab-terminal.exe'))) -and ($keyboard -match '(?m)^\| Release folder \| .*rel[\\/]0\.3\.2 \|') -and ($keyboard -notmatch '\{\{')) $keyboard
    $closeText = [System.IO.File]::ReadAllText((Join-Path $case "${TestDate}_minimised-close.md"), $Utf8)
    Check 'an older template (a stale installer hash row and the bare phrase) is brought up to date too' (($closeText -match "(?m)^\| Installer SHA-256 \| $FixtureSha \|") -and ($closeText -notmatch '2f4b5c4cdf37') -and ($closeText -match "(?m)^\| Release commit \| desktop-v$TagVersion at $tagCommit \|"))
    Check 'a run with every fact known prints no unfilled-field warning' ($r.text -notmatch 'could not be filled')
    $nvda = [System.IO.File]::ReadAllText((Join-Path $case "${TestDate}_nvda.md"), $Utf8)
    Check 'empty Release commit and Installer rows are filled too' (($nvda.Contains($tagCommit)) -and ($nvda.Contains($FixtureSha)) -and ($nvda -match '(?m)^\| NVDA version \| \|$'))
    $template = [System.IO.File]::ReadAllText((Join-Path $case '2026-10-03_nvda.md'), $Utf8)
    Check 'the template itself is not changed' ($template -match '(?m)^\| Run date \| \|$')
    Check 'the output prints a line for each record written' (@([regex]::Matches($r.text, '(?m)^  RECORD written: ')).Count -eq 3) $r.text

    $caseWarn = New-Case 'unfilled'
    $r = Invoke-Session ((Get-BaseArguments $caseWarn -SumsFile (Join-Path $Fixtures 'SHA256SUMS')) + @('-Only', 'real-keyboard'))
    $unfilled = [System.IO.File]::ReadAllText((Join-Path $caseWarn "${TestDate}_real-keyboard.md"), $Utf8)
    Check 'a fact that cannot be read (no installer file beside the sums) leaves its marker and warns (born failing)' (($r.code -eq 0) -and ($unfilled -match '\{\{installer size in bytes') -and ($r.text -match 'WARN  1 fill-in field'))

    # ---- an existing record is refused, not overwritten ------------------------------------------------------------------
    $mine = Join-Path $case "${TestDate}_nvda.md"
    [System.IO.File]::WriteAllText($mine, "owner notes, do not lose`n", $Utf8)
    $hashBefore = (Get-FileHash -LiteralPath $mine -Algorithm SHA256).Hash
    $mtimeBefore = (Get-Item -LiteralPath $mine).LastWriteTimeUtc.Ticks
    $r = Invoke-Session (Get-BaseArguments $case)
    Check 'an existing record is refused, not overwritten (born failing)' (($r.code -eq 1) -and ($r.text -match 'REFUSED .*nvda') -and ((Get-FileHash -LiteralPath $mine -Algorithm SHA256).Hash -eq $hashBefore) -and ((Get-Item -LiteralPath $mine).LastWriteTimeUtc.Ticks -eq $mtimeBefore)) $r.text
    Check 'a refused step does not stop the others from being reported' (@([regex]::Matches($r.text, '(?m)^STEP \d+ of \d+:')).Count -eq 3)
    $r = Invoke-Session ((Get-BaseArguments $case) + @('-DryRun'))
    Check '-DryRun reports an existing record as one that would be refused, counts it and exits 1 like the real run (born failing)' (($r.code -eq 1) -and ($r.text -match 'WOULD REFUSE .*nvda') -and ($r.text -match '(?m)^owner-session dry run done: 0 would be written, 3 would be refused, 3 steps\.')) $r.text

    # ---- a record that would be the template itself ---------------------------------------------------------------------
    $case = New-Case 'selfdate'
    $r = Invoke-Session ((Get-BaseArguments $case -Date '2026-10-11') + @('-Only', 'minimised-close'))
    $templateText = [System.IO.File]::ReadAllText((Join-Path $case '2026-10-11_minimised-close.md'), $Utf8)
    Check 'a record dated like its template (same file) is refused and the template stays untouched (born failing)' (($r.code -eq 1) -and ($r.text -match 'REFUSED') -and ($templateText -match '(?m)^\| Run date \| \|$')) $r.text
    Check 'a record dated like its template tells the owner which -Date to pass (born failing)' ($r.text -match '(?m)^1 record name\(s\) .*template.* -Date 2026-10-12') $r.text
    $r = Invoke-Session ((Get-BaseArguments $case -Date '2026-10-11') + @('-DryRun'))
    Check '-DryRun on the date of a template reports the clash as a refusal, counts it and exits 1 (born failing)' (($r.code -eq 1) -and ($r.text -match 'WOULD REFUSE \(minimised-close\)') -and ($r.text -match '(?m)^owner-session dry run done: 2 would be written, 1 would be refused, 3 steps\.') -and ($r.text -match '-Date 2026-10-12')) $r.text

    # ---- a write that cannot happen is a failure, reported as FAILED, and leaves no partial record ------------------------
    $case = New-Case 'writefail'
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls $case /deny "${me}:(WD,AD)" | Out-Null
    $r = Invoke-Session ((Get-BaseArguments $case) + @('-Only', 'nvda'))
    & icacls $case /remove:d $me | Out-Null
    $left = @(Get-ChildItem -LiteralPath $case -Force | Where-Object { ($_.Name -like "${TestDate}_*") -or ($_.Name -like '*.tmp') -or ($_.Name -like '.*') })
    Check 'a record that cannot be written is reported as FAILED with the exception type, not as REFUSED, with exit code 1 (born failing)' (($r.code -eq 1) -and ($r.text -match 'FAILED \(nvda\).*UnauthorizedAccessException') -and ($r.text -cnotmatch 'REFUSED')) $r.text
    Check 'the summary counts a failed write separately from a refusal (born failing)' ($r.text -match '0 written, 0 refused, 1 failed') $r.text
    Check 'a failed write leaves no record and no temporary file behind (born failing)' ($left.Count -eq 0) (($left | ForEach-Object Name) -join ',')
    $r = Invoke-Session ((Get-BaseArguments $case) + @('-Only', 'nvda'))
    Check 'after a failed write the same record can be written on a rerun (it is not refused as existing)' (($r.code -eq 0) -and ($r.text -match 'RECORD written') -and ($r.text -cnotmatch 'REFUSED')) $r.text
    Check 'the written record after the rerun is complete (holds the installer SHA-256)' ([System.IO.File]::ReadAllText((Join-Path $case "${TestDate}_nvda.md"), $Utf8) -match $FixtureSha)

    # ---- a missing template fails, and nothing is written ----------------------------------------------------------------
    $case = New-Case 'notemplate'
    Remove-Item -LiteralPath (Join-Path $case '2026-10-03_nvda.md')
    $r = Invoke-Session (Get-BaseArguments $case)
    Check 'a missing template fails with exit code 1 and names the template (born failing)' (($r.code -eq 1) -and ($r.text -match 'FAIL  .*2026-10-03_nvda\.md')) $r.text
    Check 'a missing template stops the whole run before any record is written' (@(Get-ChildItem -LiteralPath $case -Filter "${TestDate}_*.md").Count -eq 0)

    # ---- a version with no tag fails -------------------------------------------------------------------------------------
    $case = New-Case 'notag'
    $r = Invoke-Session ((Get-BaseArguments $case -Version '9.9.9') + @('-AllowVersionMismatch'))
    Check 'a version with no tag fails with exit code 2 and names the tag (born failing)' (($r.code -eq 2) -and ($r.text -match 'desktop-v9\.9\.9')) $r.text
    Check 'a version with no tag writes no record' (@(Get-ChildItem -LiteralPath $case -Filter "${TestDate}_*.md").Count -eq 0)

    # ---- a version with no installer line in the sums fails --------------------------------------------------------------
    $case = New-Case 'nosum'
    $r = Invoke-Session ((Get-BaseArguments $case -Version '0.3.1') + @('-AllowVersionMismatch'))
    Check 'a tagged version with no installer line in the sums fails with exit code 2 (born failing)' (($r.code -eq 2) -and ($r.text -match 'SHA-256') -and (@(Get-ChildItem -LiteralPath $case -Filter "${TestDate}_*.md").Count -eq 0)) $r.text
    $r = Invoke-Session (Get-BaseArguments $case -SumsFile (Join-Path $Scratch 'no-such-sums'))
    Check 'a sums file that does not exist fails with exit code 2' ($r.code -eq 2)

    # ---- a target outside the checks folder is refused -------------------------------------------------------------------
    $case = New-Case 'outside'
    $canary = Join-Path (Split-Path $case -Parent) 'canary.txt'
    [System.IO.File]::WriteAllText($canary, 'canary', $Utf8)
    $outside = Write-OrderFile 'outside' @(@{ check = '..\escaped'; template = '2026-10-03_nvda.md'; minutes = 5 })
    $r = Invoke-Session (Get-BaseArguments $case $outside)
    Check 'a check name that climbs out of the folder is refused and nothing is written (born failing)' (($r.code -eq 1) -and ($r.text -match 'outside') -and -not (Test-Path -LiteralPath (Join-Path (Split-Path $case -Parent) "${TestDate}_escaped.md"))) $r.text
    $outside = Write-OrderFile 'outside' @(@{ check = 'nvda'; template = '..\canary.txt'; minutes = 5 })
    $r = Invoke-Session (Get-BaseArguments $case $outside)
    Check 'a template that climbs out of the folder is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'outside') -and (@(Get-ChildItem -LiteralPath $case -Filter "${TestDate}_*.md").Count -eq 0)) $r.text
    $outside = Write-OrderFile 'outside' @(@{ check = 'nvda'; template = 'C:\Windows\win.ini'; minutes = 5 })
    $r = Invoke-Session (Get-BaseArguments $case $outside)
    Check 'a template given as an absolute path is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'outside|FAIL'))
    $outside = Write-OrderFile 'outside' @(@{ check = 'sub\nvda'; template = '2026-10-03_nvda.md'; minutes = 5 })
    $r = Invoke-Session (Get-BaseArguments $case $outside)
    Check 'a record in a sub-folder of the checks folder is refused (born failing)' (($r.code -eq 1) -and ($r.text -match 'outside') -and (@(Get-ChildItem -LiteralPath $case -Recurse -Filter "*nvda.md").Count -eq 1))
    Check 'the canary beside the checks folder is unchanged' ([System.IO.File]::ReadAllText($canary) -eq 'canary')
    $r = Invoke-Session ((Get-BaseArguments 'C:\Windows\Temp\owner-session-not-allowed') + @('-DryRun'))
    Check 'a -ChecksDir hook outside D:\dev\tmp is refused with exit code 2 (born failing)' (($r.code -eq 2) -and ($r.text -match 'D:\\dev\\tmp') -and -not (Test-Path -LiteralPath 'C:\Windows\Temp\owner-session-not-allowed'))

    # ---- the requested version must be the installed one -------------------------------------------------------------------
    $case = New-Case 'mismatch'
    $r = Invoke-Session (Get-BaseArguments $case -Version '0.3.1')
    Check 'a version that is not the installed one is refused in a real run, naming both versions and the switch (born failing)' (($r.code -eq 2) -and ($r.text -match 'WARN  .*0\.3\.1.*0\.3\.2|WARN  .*0\.3\.2.*0\.3\.1') -and ($r.text -match 'AllowVersionMismatch') -and (@(Get-ChildItem -LiteralPath $case -Filter "${TestDate}_*.md").Count -eq 0)) $r.text
    $r = Invoke-Session ((Get-BaseArguments $case -Version '0.3.1') + @('-DryRun'))
    Check 'a dry run with a version that is not the installed one only warns (born failing)' (($r.code -eq 0) -and ($r.text -match 'WARN  .*installed.*0\.3\.2')) $r.text
    $r = Invoke-Session ((Get-BaseArguments $case -UninstallSub 'UninstallOld') + @('-AllowVersionMismatch', '-Only', 'real-keyboard'))
    $mismatchRecord = if (Test-Path -LiteralPath (Join-Path $case "${TestDate}_real-keyboard.md")) { [System.IO.File]::ReadAllText((Join-Path $case "${TestDate}_real-keyboard.md"), $Utf8) } else { '' }
    Check '-AllowVersionMismatch lets the run go on with a warning and a note in the record that names the installed version (born failing)' (($r.code -eq 0) -and ($r.text -match 'WARN  .*0\.3\.1') -and ($mismatchRecord -match 'installed version is 0\.3\.1') -and ($mismatchRecord -match 'not 0\.3\.2')) $r.text
    $case = New-Case 'noversion'
    $r = Invoke-Session (Get-BaseArguments $case -UninstallSub 'UninstallNoVersion')
    Check 'an uninstall entry with no DisplayVersion is refused in a real run (born failing)' (($r.code -eq 2) -and ($r.text -match 'DisplayVersion') -and ($r.text -match 'AllowVersionMismatch') -and (@(Get-ChildItem -LiteralPath $case -Filter "${TestDate}_*.md").Count -eq 0)) $r.text
    $r = Invoke-Session ((Get-BaseArguments $case -UninstallSub 'UninstallNoVersion') + @('-AllowVersionMismatch', '-Only', 'real-keyboard'))
    $unconfirmedRecord = if (Test-Path -LiteralPath (Join-Path $case "${TestDate}_real-keyboard.md")) { [System.IO.File]::ReadAllText((Join-Path $case "${TestDate}_real-keyboard.md"), $Utf8) } else { '' }
    Check 'with -AllowVersionMismatch the record says that the installed version could not be confirmed (born failing)' (($r.code -eq 0) -and ($unconfirmedRecord -match 'could not be confirmed')) $r.text
    $r = Invoke-Session (Get-BaseArguments (New-Case 'matching'))
    Check 'a version that is the installed one runs without a version warning or note' (($r.code -eq 0) -and ($r.text -notmatch 'AllowVersionMismatch') -and ($r.text -notmatch 'could not be confirmed')) $r.text

    # ---- the order file and the version ----------------------------------------------------------------------------------
    $case = New-Case 'badinput'
    $r = Invoke-Session (Get-BaseArguments $case -OrderFile (Join-Path $Scratch 'no-such-order.json'))
    Check 'an order file that does not exist is refused with exit code 2' ($r.code -eq 2)
    $broken = Join-Path $Scratch 'badinput\broken.json'
    [System.IO.File]::WriteAllText($broken, '{ "steps": [ { "check": ', $Utf8)
    $r = Invoke-Session (Get-BaseArguments $case $broken)
    Check 'an order file that is not JSON is refused with exit code 2' ($r.code -eq 2)
    $dupe = Write-OrderFile 'badinput' @(@{ check = 'nvda'; template = '2026-10-03_nvda.md'; minutes = 5 }, @{ check = 'nvda'; template = '2026-10-03_nvda.md'; minutes = 5 })
    $r = Invoke-Session (Get-BaseArguments $case $dupe)
    Check 'a list that names a check twice is refused with exit code 2' (($r.code -eq 2) -and ($r.text -match 'twice'))
    $emptyList = Write-OrderFile 'badinput' @()
    $r = Invoke-Session (Get-BaseArguments $case $emptyList)
    Check 'an empty list is refused with exit code 2' ($r.code -eq 2)
    foreach ($bad in '1.2', '..\0.3.2', '0.3.2-rc1') {
        $r = Invoke-Session (Get-BaseArguments $case -Version $bad)
        Check "the version '$bad' is refused with exit code 2" ($r.code -eq 2)
    }
    $argsNoVersion = @('-Sums', (Join-Path $Fixtures 'SHA256SUMS'), '-Order', (Join-Path $Fixtures 'session_order.json'), '-ChecksDir', $case, '-Date', $TestDate, '-DryRun', '-UninstallRoot', "$FakeRoot\UninstallNoVersion")
    $r = Invoke-Session $argsNoVersion
    Check 'with no -Version and no DisplayVersion in the uninstall entry the run is refused with exit code 2' (($r.code -eq 2) -and ($r.text -match 'uninstall entry'))
    $key = "$FakeRoot\Uninstall\nq-lab terminal"
    $argsNoVersion[-1] = "$FakeRoot\Uninstall"
    $r = Invoke-Session $argsNoVersion
    Check 'with no -Version the DisplayVersion of the uninstall entry is used' (($r.code -eq 0) -and ($r.text -match "version $([regex]::Escape($TagVersion))") -and ($r.text -match 'uninstall entry'))
    Check 'reading the uninstall entry leaves it as it was' ((Get-ItemProperty -LiteralPath $key).DisplayVersion -eq $TagVersion)
    $r = Invoke-Session ((Get-BaseArguments $case -SumsFile 'NONE' -Releases (Join-Path $Scratch 'releases')) + @('-DryRun'))
    Check 'the sums default to SHA256SUMS in the release folder of the version, and a missing file only warns in a dry run' (($r.code -eq 0))
    $r = Invoke-Session ((Get-BaseArguments $case -SumsFile 'NONE' -Releases (Join-Path $Scratch 'releases')))
    Check 'a real run with no sums file in the release folder fails with exit code 2' (($r.code -eq 2) -and ($r.text -match 'SHA256SUMS'))
} finally {
    if (Test-Path -LiteralPath $FakeRoot) { Remove-Item -LiteralPath $FakeRoot -Recurse -Force }
    if (Test-Path -LiteralPath $Scratch) { Remove-Item -LiteralPath $Scratch -Recurse -Force }
}
Check 'no record dated the test date reached the real checks folder' (@(Get-ChildItem -LiteralPath $RealChecks -Filter "${TestDate}_*").Count -eq 0)
Check 'the fake registry root and the scratch folder are gone' (-not (Test-Path -LiteralPath $FakeRoot) -and -not (Test-Path -LiteralPath $Scratch))

Write-Host ''
Write-Host ("owner-session tests: {0} passed, {1} failed" -f $Passed, $Failed.Count)
if ($Failed.Count -gt 0) { Write-Host ("FAILED: " + ($Failed -join '; ')); exit 1 }
exit 0
