# The owner's guided session for one installed version of the nq-lab terminal.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\owner-session.ps1 [-Version x.y.z] [-Only a,b] [-Sums <SHA256SUMS>] [-DryRun] [-AllowVersionMismatch]
#
# For each step of docs\desktop\checks\session_order.json (or the file given with -Order) it prints the purpose, the owner time
# and the copy-paste commands of the step, then copies the step's template to docs\desktop\checks\YYYY-MM-DD_<check>.md with the
# version, the installer SHA-256, the release commit and the date filled in. The owner then does the check by hand and ticks the
# record.
#
# What it never does: overwrite a record, launch the app, close or stop a process, contact IB, TWS or QuantPad, or write outside
# the checks folder. It reads the uninstall entry of the installed app, the release folder's sums and the tag of the version with
# git rev-parse, and nothing else. -DryRun prints the same steps and writes nothing.
#
# Order file: {"steps": [{"check": "nvda", "template": "2026-10-03_nvda.md", "minutes": 15}, ...]} (a bare array also works).
# "purpose" and "commands" are optional in a step; without them the template's Purpose section and its powershell blocks are used.
#
# Exit codes: 0 done; 1 a record was refused (in a dry run: would be refused) or could not be written (FAILED), or a template or target was unusable (the
# preflight writes nothing); 2 unusable
# input (version, tag, sums, order file, -Only name, test hook).
#
# Test hooks (the tests use them): -ChecksDir (accepted only under D:\dev\tmp), -RepoRoot, -ReleaseRoot, -UninstallRoot, -Date.
# The owner uses -Date too, on a day a template is dated: a record named like its own template is refused, and the script
# names the next free date to pass.
[CmdletBinding()]
param(
    [string]$Version,
    [string[]]$Only,
    [string]$Sums,
    [switch]$DryRun,
    [switch]$AllowVersionMismatch,
    [string]$Order,
    [string]$Date,
    [string]$ChecksDir,
    [string]$RepoRoot,
    [string]$ReleaseRoot = 'D:\dev\release',
    [string]$UninstallRoot = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProductKey = 'nq-lab terminal'
$FillPhrase = 'installed tag and release commit (desktop/scripts/owner-session.ps1 fills this)'
$TestFolderRoot = 'D:\dev\tmp'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Stop-Session {
    param([int]$Code, [string]$Message)
    Write-Host "FAIL  $Message"
    exit $Code
}

function Get-Prop {
    # The first property of an object that exists under one of the names, or $null.
    param($Object, [string[]]$Names)
    foreach ($name in $Names) {
        $prop = $Object.PSObject.Properties[$name]
        if ($null -ne $prop) { return $prop.Value }
    }
    return $null
}

function Test-InFolder {
    # True when the full path is a direct child of the folder; any path that cannot be resolved counts as outside.
    param([string]$Path, [string]$Folder)
    try {
        $full = [System.IO.Path]::GetFullPath($Path)
        $root = [System.IO.Path]::GetFullPath($Folder).TrimEnd('\')
    } catch { return $false }
    $parent = [System.IO.Path]::GetDirectoryName($full)
    return ($null -ne $parent) -and ($parent.TrimEnd('\') -ieq $root)
}

function Resolve-InFolder {
    # Join a name to the folder; $null when the result is not a direct child of it.
    param([string]$Folder, [string]$Name)
    try { $joined = Join-Path $Folder $Name } catch { return $null }
    if (Test-InFolder $joined $Folder) { return [System.IO.Path]::GetFullPath($joined) }
    return $null
}

function Get-UninstallValue {
    # One value of the uninstall entry (read only), or $null when the key or the value is not there.
    param([string]$Key, [string]$Name)
    if (-not (Test-Path -LiteralPath $Key)) { return $null }
    $prop = (Get-ItemProperty -LiteralPath $Key).PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return [string]$prop.Value
}

function Resolve-Version {
    param([string]$Given)
    if ($Given) { $found = $Given; $source = '-Version' } else {
        $key = Join-Path $UninstallRoot $ProductKey
        $found = Get-UninstallValue $key 'DisplayVersion'
        if (-not $found) { Stop-Session 2 "no -Version given and no DisplayVersion in the uninstall entry '$ProductKey' (pass -Version x.y.z)" }
        $source = 'uninstall entry'
    }
    if ($found -notmatch '^\d+\.\d+\.\d+$') { Stop-Session 2 "'$found' is not a version of the form x.y.z" }
    return @{ version = $found; source = $source }
}

function Confirm-InstalledVersion {
    # Checks the requested version against DisplayVersion of the uninstall entry, whose InstallLocation the records quote. A match
    # returns ''. Otherwise it prints a WARN naming both versions and returns the note for the records; a real run is refused
    # (exit 2) unless -AllowVersionMismatch is passed.
    param([string]$Ver, [bool]$Dry)
    $installed = Get-UninstallValue (Join-Path $UninstallRoot $ProductKey) 'DisplayVersion'
    if ($installed) { $installed = $installed.Trim() }
    if ($installed -eq $Ver) { return '' }
    if ($installed) {
        $problem = "the installed version is $installed, not $Ver (the executable path comes from the installed one)"
        $note = "Installed version check: the installed version is $installed, not $Ver; the executable path and every hand check below belong to the installed build."
    } else {
        $problem = "the installed version could not be confirmed: no DisplayVersion in the uninstall entry '$ProductKey' (requested $Ver)"
        $note = "Installed version check: the installed version could not be confirmed (no DisplayVersion in the uninstall entry), so the executable path may belong to a build other than $Ver."
    }
    Write-Host "WARN  $problem"
    if ((-not $Dry) -and (-not $AllowVersionMismatch)) { Stop-Session 2 "$problem; install that version or pass -AllowVersionMismatch to write records anyway" }
    return $note
}

function Get-TagCommit {
    # The commit of the tag desktop-v<version> (read only), or $null.
    param([string]$Root, [string]$Ver)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $commit = (& git -C $Root rev-parse --verify --quiet "refs/tags/desktop-v$Ver^{commit}" 2>$null)
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
    if (($code -eq 0) -and ("$commit" -match '^[0-9a-f]{40}$')) { return "$commit" }
    return $null
}

function Get-InstallerSha {
    # The SHA-256 of 'nq-lab terminal_<version>_x64-setup.exe' from a SHA256SUMS file; returns @{sha; problem}.
    param([string]$SumsPath, [string]$Ver)
    if (-not (Test-Path -LiteralPath $SumsPath -PathType Leaf)) { return @{ sha = $null; problem = "no SHA256SUMS file at $SumsPath" } }
    $name = [regex]::Escape("$ProductKey`_${Ver}_x64-setup.exe")
    foreach ($line in [System.IO.File]::ReadAllLines($SumsPath)) {
        if ($line -match "^([0-9a-fA-F]{64}) [ *]?$name\s*$") { return @{ sha = $Matches[1].ToLowerInvariant(); problem = $null } }
    }
    return @{ sha = $null; problem = "no SHA-256 line for '$ProductKey`_${Ver}_x64-setup.exe' in $SumsPath" }
}

function Get-InstallFacts {
    # Read-only facts for the optional fill-in markers: the installer's file name and size (the file beside the sums), the release
    # folder, and the installed executable's path from the uninstall entry. A fact that cannot be read is $null.
    param([string]$Ver, [string]$SumsPath)
    $file = "$ProductKey`_${Ver}_x64-setup.exe"
    $facts = @{ installerFile = $file; releaseDir = (Join-Path $ReleaseRoot $Ver); installerSize = $null; executable = $null }
    $installer = Join-Path (Split-Path -Parent $SumsPath) $file
    if (Test-Path -LiteralPath $installer -PathType Leaf) { $facts.installerSize = (Get-Item -LiteralPath $installer).Length.ToString('N0', [System.Globalization.CultureInfo]::InvariantCulture) }
    $key = Join-Path $UninstallRoot $ProductKey
    $location = Get-UninstallValue $key 'InstallLocation'
    if ($location) { $facts.executable = Join-Path ($location.Trim('"')) 'nq-lab-terminal.exe' }
    return $facts
}

function Get-OwnerMinutes {
    param($Step)
    $raw = Get-Prop $Step @('minutes', 'owner_minutes', 'owner_time')
    if ($null -eq $raw) { return $null }
    if ($raw -is [int] -or $raw -is [long] -or $raw -is [double]) { return [int]$raw }
    if ("$raw" -match '(\d+)') { return [int]$Matches[1] }
    return $null
}

function Read-OrderFile {
    # The steps of the order file as objects with Check, Template, Minutes, Purpose and Commands (the last two may be $null).
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Stop-Session 2 "the order file $Path does not exist" }
    try { $doc = [System.IO.File]::ReadAllText($Path, $Utf8) | ConvertFrom-Json } catch { Stop-Session 2 "the order file $Path is not valid JSON: $($_.Exception.Message)" }
    $list = if ($doc -is [array]) { $doc } else { Get-Prop $doc @('steps', 'session') }
    $steps = New-Object System.Collections.Generic.List[object]
    foreach ($item in @($list)) {
        $template = Get-Prop $item @('template', 'file')
        $check = Get-Prop $item @('check', 'name', 'id')
        if (-not $template) { Stop-Session 2 "a step of $Path has no template" }
        if (-not $check) { $check = [regex]::Replace([string]$template, '^\d{4}-\d{2}-\d{2}_|\.md$', '') }
        $steps.Add([pscustomobject]@{ Check = [string]$check; Template = [string]$template; Minutes = (Get-OwnerMinutes $item)
            Purpose = (Get-Prop $item @('purpose')); Commands = (Get-Prop $item @('commands')) })
    }
    if ($steps.Count -eq 0) { Stop-Session 2 "the order file $Path lists no steps" }
    $dupe = @($steps | Group-Object Check | Where-Object { $_.Count -gt 1 })
    if ($dupe.Count -gt 0) { Stop-Session 2 "the order file names the check '$($dupe[0].Name)' twice" }
    return $steps
}

function Select-Steps {
    param($Steps, [string[]]$Wanted)
    $names = @($Wanted | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
    if ($names.Count -eq 0) { return $Steps }
    foreach ($n in $names) {
        if (@($Steps | Where-Object { $_.Check -eq $n }).Count -eq 0) { Stop-Session 2 "-Only names '$n', which is not a check of the order file (known: $(($Steps | ForEach-Object { $_.Check }) -join ', '))" }
    }
    return @($Steps | Where-Object { $names -contains $_.Check })
}

function Get-TemplatePurpose {
    param([string]$Text)
    $m = [regex]::Match($Text, '(?ms)^## Purpose\s*\r?\n\s*\r?\n(.*?)(?:\r?\n\s*\r?\n|\z)')
    if (-not $m.Success) { return $null }
    $paragraph = ($m.Groups[1].Value -replace '\s*\r?\n\s*', ' ').Trim()
    if ($paragraph.Length -gt 600) { $paragraph = $paragraph.Substring(0, 600).TrimEnd() + ' ...' }
    return $paragraph
}

function Get-TemplateCommands {
    param([string]$Text)
    $blocks = [regex]::Matches($Text, '(?ms)^```(?:powershell|pwsh|ps1)[ \t]*\r?\n(.*?)^```[ \t]*\r?$')
    return @($blocks | ForEach-Object { $_.Groups[1].Value.TrimEnd() })
}

function Set-FillMarkers {
    # Replaces each {{ description (desktop/scripts/owner-session.ps1 fills this)}} marker whose description is known; the
    # others, and any known one whose fact is missing, stay as they are. The bare phrase of the older templates is filled too.
    param([string]$Text, [hashtable]$Facts)
    $known = [ordered]@{
        'installed tag and release commit' = "desktop-v$($Facts.version) at $($Facts.commit)"
        'installer sha-256' = $Facts.sha
        'installer file name' = $Facts.installerFile
        'installer size in bytes' = $Facts.installerSize
        'path of the installed executable' = $Facts.executable
        'release folder' = $Facts.releaseDir }
    $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{
        param($m)
        $description = $m.Groups[1].Value.Trim().ToLowerInvariant()
        foreach ($key in $known.Keys) { if ($description.StartsWith($key) -and $known[$key]) { return [string]$known[$key] } }
        return $m.Value
    }
    $marker = New-Object System.Text.RegularExpressions.Regex('\{\{([^{}]*?)\(desktop/scripts/owner-session\.ps1 fills this\)\s*\}\}')
    return $marker.Replace($Text, $evaluator).Replace($FillPhrase, $known['installed tag and release commit'])
}

function Set-RecordFields {
    # The template text with the version facts filled in (table rows with an empty or stale value, and the fill-in phrase).
    param([string]$Text, [hashtable]$Facts)
    $tagAtCommit = "desktop-v$($Facts.version) at $($Facts.commit)"
    $out = Set-FillMarkers $Text $Facts
    $rows = @(
        @{ label = 'Run date'; value = $Facts.date; stale = '' },
        @{ label = 'Installer SHA-256'; value = $Facts.sha; stale = '[0-9a-fA-F]{64}' },
        @{ label = 'Installed tag and release commit'; value = $tagAtCommit; stale = '' },
        @{ label = 'Release commit'; value = $tagAtCommit; stale = '[0-9a-f]{40}' })
    foreach ($row in $rows) {
        $pattern = '(?m)^(\|\s*' + [regex]::Escape($row.label) + '\s*\|)[ \t]*(' + $row.stale + ')[ \t]*\|[ \t]*(\r?)$'
        $value = $row.value
        $out = [regex]::Replace($out, $pattern, { param($m) $m.Groups[1].Value + ' ' + $value + ' |' + $m.Groups[3].Value }.GetNewClosure())
    }
    $note = "Pre-filled by desktop/scripts/owner-session.ps1 on $($Facts.date): version $($Facts.version), tag desktop-v$($Facts.version), commit $($Facts.commit), installer SHA-256 $($Facts.sha)."
    if ($Facts.installNote) { $note = "$note $($Facts.installNote)" }
    $firstLine = New-Object System.Text.RegularExpressions.Regex('\A([^\r\n]*)(\r?\n)')
    $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $m.Groups[1].Value + $m.Groups[2].Value + $m.Groups[2].Value + $note + $m.Groups[2].Value }
    return $firstLine.Replace($out, $evaluator, 1)
}

function Write-NewRecord {
    # Creates the file complete or not at all. The text goes to a temporary file in the same folder, which is then moved into
    # place without overwriting (File.Move throws if the record exists), so a failed write never leaves a partial record.
    param([string]$Path, [string]$Text)
    $temp = Join-Path (Split-Path -Parent $Path) ('.' + (Split-Path -Leaf $Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $stream = [System.IO.File]::Open($temp, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
        try { $bytes = $Utf8.GetBytes($Text); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
        [System.IO.File]::Move($temp, $Path)
    } finally {
        if (Test-Path -LiteralPath $temp) { try { [System.IO.File]::Delete($temp) } catch { Write-Host "  WARN  could not remove the temporary file ${temp}: $($_.Exception.Message)" } }
    }
}

function Write-StepHeader {
    param($Step, [int]$Index, [int]$Count, [string]$Text)
    $purpose = if ($Step.Purpose) { [string]$Step.Purpose } else { Get-TemplatePurpose $Text }
    $commands = @(if ($Step.Commands) { $Step.Commands | ForEach-Object { [string]$_ } } else { Get-TemplateCommands $Text })
    Write-Host ''
    Write-Host "STEP $Index of ${Count}: $($Step.Check)"
    Write-Host "  Purpose: $purpose"
    $time = if ($null -ne $Step.Minutes) { "$($Step.Minutes) minutes" } else { 'not stated' }
    Write-Host "  Owner time: $time"
    Write-Host "  Template: $($Step.Template)"
    if ($commands.Count -gt 0) {
        Write-Host '  Commands (copy and paste):'
        foreach ($block in $commands) { foreach ($line in ($block -split '\r?\n')) { Write-Host "    $line" } }
    }
}

function Get-StepPaths {
    # Resolves and checks template and record paths; returns the failures (nothing is written here).
    param($Steps, [string]$Folder, [string]$DateText)
    $problems = New-Object System.Collections.Generic.List[string]
    foreach ($step in $Steps) {
        $templatePath = Resolve-InFolder $Folder $step.Template
        $recordPath = Resolve-InFolder $Folder "${DateText}_$($step.Check).md"
        if ($null -eq $templatePath) { $problems.Add("the template '$($step.Template)' of '$($step.Check)' is outside the checks folder"); continue }
        if ($null -eq $recordPath) { $problems.Add("the record for '$($step.Check)' would be outside the checks folder"); continue }
        if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) { $problems.Add("the template $($step.Template) of '$($step.Check)' does not exist in $Folder"); continue }
        $step | Add-Member -NotePropertyName TemplatePath -NotePropertyValue $templatePath -Force
        $step | Add-Member -NotePropertyName RecordPath -NotePropertyValue $recordPath -Force
    }
    return $problems
}

function Invoke-Step {
    # One step: print it, then write the record (or report that it would be, or that it is refused). Returns 'written', 'refused', 'failed' (an I/O error, not a policy refusal),
    # or in a dry run 'would' (would be written) or 'would-refuse' (would be refused, which a dry run counts and fails on too).
    param($Step, [int]$Index, [int]$Count, [hashtable]$Facts, [bool]$Dry)
    $text = [System.IO.File]::ReadAllText($Step.TemplatePath, $Utf8)
    Write-StepHeader $Step $Index $Count $text
    $exists = Test-Path -LiteralPath $Step.RecordPath
    if ($exists) {
        $why = if ($Step.RecordPath -ieq $Step.TemplatePath) { 'that file is the template itself; run on another day or pass -Date' } else { 'a record with that name exists and is never overwritten' }
        $label = if ($Dry) { 'WOULD REFUSE' } else { 'REFUSED' }
        Write-Host "  $label ($($Step.Check)): $($Step.RecordPath): $why"
        if ($Dry) { return 'would-refuse' } else { return 'refused' }
    }
    if ($Dry) { Write-Host "  WOULD WRITE: $($Step.RecordPath)"; return 'would' }
    $filled = Set-RecordFields $text $Facts
    try { Write-NewRecord $Step.RecordPath $filled } catch {
        if (Test-Path -LiteralPath $Step.RecordPath) {
            Write-Host "  REFUSED ($($Step.Check)): $($Step.RecordPath): a record with that name appeared meanwhile and is never overwritten"
            return 'refused'
        }
        $failure = if ($_.Exception.InnerException) { $_.Exception.InnerException } else { $_.Exception }  # PowerShell wraps .NET calls
        Write-Host "  FAILED ($($Step.Check)): $($Step.RecordPath): the record could not be written, $($failure.GetType().Name): $($failure.Message) (no partial record was left)"
        return 'failed'
    }
    $left = [regex]::Matches($filled, 'fills this\)').Count
    if ($left -gt 0) { Write-Host "  WARN  $left fill-in field(s) of this record could not be filled (the installer file or the install location was not found); fill them by hand" }
    Write-Host "  RECORD written: $($Step.RecordPath)"
    return 'written'
}

function Write-DateClashHint {
    # A record named like its own template (a template dated the run date) is always refused; name a -Date that avoids it.
    param($Steps, [string]$DateText)
    $clashes = @($Steps | Where-Object { $_.RecordPath -ieq $_.TemplatePath })
    if ($clashes.Count -eq 0) { return }
    $day = [datetime]::MinValue
    $next = 'YYYY-MM-DD (another day)'
    if ([datetime]::TryParseExact($DateText, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$day)) {
        $templates = @($Steps | ForEach-Object { $_.Template.ToLowerInvariant() })
        do {
            $day = $day.AddDays(1)
            $text = $day.ToString('yyyy-MM-dd')
            $taken = @($Steps | Where-Object { $templates -contains ("${text}_$($_.Check).md").ToLowerInvariant() }).Count
        } while ($taken -gt 0)
        $next = $text
    }
    Write-Host ''
    Write-Host ("{0} record name(s) on {1} are the template file itself ({2}): rerun with -Date {3} to write them under a date no template carries." -f $clashes.Count, $DateText, (($clashes | ForEach-Object { $_.Check }) -join ', '), $next)
}

function Resolve-Folders {
    $root = if ($RepoRoot) { $RepoRoot } else { Join-Path $PSScriptRoot '..\..' }
    $root = [System.IO.Path]::GetFullPath($root)
    $folder = Join-Path $root 'docs\desktop\checks'
    if ($ChecksDir) {
        $folder = [System.IO.Path]::GetFullPath($ChecksDir)
        if (-not $folder.StartsWith($TestFolderRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { Stop-Session 2 "-ChecksDir is a test hook and is accepted only under $TestFolderRoot\" }
        Write-Host "WARN  a test hook moves the checks folder to $folder"
    }
    return @{ root = $root; checks = $folder }
}

function Resolve-Facts {
    param([string]$Root, [bool]$Dry)
    $ver = Resolve-Version $Version
    $facts = @{ version = $ver.version; source = $ver.source; commit = $null; sha = $null }
    $facts.installNote = Confirm-InstalledVersion $ver.version $Dry
    $facts.date = if ($Date) { $Date } else { (Get-Date).ToString('yyyy-MM-dd') }
    if ($facts.date -notmatch '^\d{4}-\d{2}-\d{2}$') { Stop-Session 2 "-Date '$($facts.date)' is not YYYY-MM-DD" }
    $facts.commit = Get-TagCommit $Root $ver.version
    $sumsPath = if ($Sums) { $Sums } else { Join-Path (Join-Path $ReleaseRoot $ver.version) 'SHA256SUMS' }
    $found = Get-InstallerSha $sumsPath $ver.version
    $facts.sha = $found.sha
    $more = Get-InstallFacts $ver.version $sumsPath
    foreach ($key in $more.Keys) { $facts[$key] = $more[$key] }
    $problems = @()
    if (-not $facts.commit) { $problems += "the tag desktop-v$($ver.version) does not name a commit in $Root" }
    if ($found.problem) { $problems += "the installer SHA-256 is unknown: $($found.problem)" }
    foreach ($p in $problems) { if ($Dry) { Write-Host "WARN  $p" } else { Stop-Session 2 $p } }
    if ($Dry) {
        if (-not $facts.commit) { $facts.commit = '(no tag)' }
        if (-not $facts.sha) { $facts.sha = '(unknown)' }
    }
    return $facts
}

function Invoke-Session {
    $dry = [bool]$DryRun
    $folders = Resolve-Folders
    $facts = Resolve-Facts $folders.root $dry
    $orderPath = if ($Order) { $Order } else { Join-Path $folders.root 'docs\desktop\checks\session_order.json' }
    $steps = @(Select-Steps (Read-OrderFile $orderPath) $Only)
    $problems = @(Get-StepPaths $steps $folders.checks $facts.date)
    if ($problems.Count -gt 0) { foreach ($p in $problems) { Write-Host "FAIL  $p" }; exit 1 }
    $total = ($steps | ForEach-Object { if ($null -ne $_.Minutes) { $_.Minutes } else { 0 } } | Measure-Object -Sum).Sum
    Write-Host "owner-session: version $($facts.version) (from the $($facts.source)), tag desktop-v$($facts.version), commit $($facts.commit), date $($facts.date)"
    Write-Host "installer SHA-256: $($facts.sha)"
    $stepWord = if ($steps.Count -eq 1) { 'step' } else { 'steps' }
    Write-Host ("{0} {1}, about {2} minutes of owner time{3}" -f $steps.Count, $stepWord, $total, $(if ($dry) { ' (dry run, nothing is written)' } else { '' }))
    Write-Host "Set these in PowerShell first:"
    Write-Host '  $Terminal = Join-Path $env:USERPROFILE ''nq-lab\terminal'''
    Write-Host ("  `$Release  = '{0}'" -f (Join-Path $ReleaseRoot $facts.version))
    $outcomes = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $steps.Count; $i++) { $outcomes.Add((Invoke-Step $steps[$i] ($i + 1) $steps.Count $facts $dry)) }
    Write-DateClashHint $steps $facts.date
    if ($dry) {
        # A dry run fails exactly where the real run would: a record that would be refused counts and exits 1.
        $wouldRefuse = @($outcomes | Where-Object { $_ -eq 'would-refuse' }).Count
        Write-Host ''
        Write-Host ("owner-session dry run done: {0} would be written, {1} would be refused, {2} steps." -f @($outcomes | Where-Object { $_ -eq 'would' }).Count, $wouldRefuse, $steps.Count)
        if ($wouldRefuse -gt 0) { exit 1 }
        exit 0
    }
    $refused = @($outcomes | Where-Object { $_ -eq 'refused' }).Count
    $failed = @($outcomes | Where-Object { $_ -eq 'failed' }).Count
    Write-Host ''
    Write-Host ("owner-session done: {0} written, {1} refused, {2} failed, {3} steps." -f @($outcomes | Where-Object { $_ -eq 'written' }).Count, $refused, $failed, $steps.Count)
    if (($refused + $failed) -gt 0) { exit 1 }
    exit 0
}

Invoke-Session
