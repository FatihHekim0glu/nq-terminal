<#
.SYNOPSIS
  Builds the GitHub release DRAFT for a desktop tag from a build-release.ps1 folder, and checks the upload by
  downloading the installer again (REL-02). It only ever makes a draft: the owner publishes it in the browser.

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\publish-release.ps1 -Tag desktop-v0.1.2 -NotesFile D:\dev\release\0.1.2-notes.md [-DryRun]

  What it does, in order:
    1. Finds the one release installer of the version in the release folder (default D:\dev\release\<version>), not
       the measure installer, and checks its sha256 against the folder's own SHA256SUMS.
    2. Names the asset the way GitHub does (spaces become dots: nq-lab.terminal_<version>_x64-setup.exe), so the
       published SHA256SUMS names the file the owner downloads, not the spaced file on the build PC.
    3. Writes SHA256SUMS holding that one line (sha256sum style, LF), in a staging folder under D:\dev\tmp.
    4. Refuses when the notes file is missing, empty, still holds a {{placeholder}}, or any text that would be
       uploaded or posted (the notes, SHA256SUMS) holds this PC's name or a C:\Users path.
    5. gh release create <tag> --draft ... with the installer and SHA256SUMS only. PROVENANCE.json (it names the
       PC), the measure installer, the payload and every other file of the folder are never uploaded.
    6. Downloads the installer from the draft again and compares its sha256 with the local file, and with the digest
       GitHub reports for the asset when it reports one. A difference fails the run and leaves the draft for the
       owner to look at (the message names the command that deletes it).
  -DryRun prints the asset name, the SHA256SUMS lines and every gh command, calls gh not at all and writes nothing.
  The tag need not exist: a draft creates it only when the owner publishes (-Target names the commit it is made on).
.PARAMETER Tag
  desktop-vX.Y.Z.
.PARAMETER NotesFile
  The release notes, a Markdown file.
.PARAMETER ReleaseDir
  The build folder (default D:\dev\release\<version>).
.PARAMETER Repo
  owner/name of the GitHub repository (default FatihHekim0glu/nq-terminal).
.PARAMETER Target
  The commit or branch a new tag is created on when the draft is published (default: the repository's default branch).
.PARAMETER Title
  The release title (default: nq-lab terminal desktop <version> for Windows).
.PARAMETER Gh
  The gh program (default gh). The self-test points it at a stand-in.
.PARAMETER HostName
  The PC name that must appear in no uploaded text (default $env:COMPUTERNAME).
.PARAMETER WorkRoot
  Where the staging and download folders go (default D:\dev\tmp\publish-release).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^desktop-v\d+\.\d+\.\d+$')]
    [string]$Tag,
    [Parameter(Mandatory = $true)]
    [string]$NotesFile,
    [string]$ReleaseDir = '',
    [string]$Repo = 'FatihHekim0glu/nq-terminal',
    [string]$Target = '',
    [string]$Title = '',
    [string]$Gh = 'gh',
    [string]$HostName = $env:COMPUTERNAME,
    [string]$WorkRoot = 'D:\dev\tmp\publish-release',
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Version = $Tag.Substring('desktop-v'.Length)
if (-not $ReleaseDir) { $ReleaseDir = Join-Path 'D:\dev\release' $Version }
if (-not $Title) { $Title = "nq-lab terminal desktop $Version for Windows" }
$Failures = New-Object System.Collections.Generic.List[string]

function Add-Failure { param([string]$Message) $Failures.Add($Message); Write-Host "publish-release: REFUSED: $Message" }

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-InstallerFile {
    $found = @(Get-ChildItem -LiteralPath $ReleaseDir -File -Filter "*_${Version}_x64-setup.exe" -ErrorAction Stop |
        Where-Object { $_.Name -notmatch 'measure|installtest' })
    if ($found.Count -ne 1) { throw "expected one release installer *_${Version}_x64-setup.exe in $ReleaseDir, found $($found.Count)" }
    return $found[0]
}

function Test-BuildChecksum {
    # The build folder's SHA256SUMS must list the installer under its spaced name with the hash just computed.
    param([string]$Name, [string]$Hash)
    $sums = Join-Path $ReleaseDir 'SHA256SUMS'
    if (-not (Test-Path -LiteralPath $sums)) { Add-Failure "$sums is missing, so the installer cannot be checked against the build"; return }
    $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match ('^[0-9a-f]{64} \*' + [regex]::Escape($Name) + '$') }
    if (-not $line) { Add-Failure "$sums does not list $Name"; return }
    if (-not $line.StartsWith($Hash)) { Add-Failure "the sha256 of $Name ($Hash) differs from the one in $sums"; }
}

function Test-UploadText {
    # Text that goes to GitHub: no placeholder, no PC name, no profile path.
    param([string]$Label, [string]$Text)
    if ($Text -match '\{\{[^}]*\}\}') { Add-Failure "$Label still holds a {{placeholder}}" }
    if ($HostName -and $Text.IndexOf($HostName, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { Add-Failure "$Label holds this PC's name" }
    if ($Text -match '(?i)[A-Z]:\\Users\\') { Add-Failure "$Label holds a profile path (C:\Users\...)" }
}

function Invoke-Gh {
    param([string[]]$Arguments)
    Write-Host ("gh " + (($Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '))
    if ($DryRun) { return @() }
    $before = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & $Gh @Arguments 2>&1 } finally { $ErrorActionPreference = $before }
    if ($LASTEXITCODE -ne 0) { throw "gh $($Arguments[0..1] -join ' ') failed (exit $LASTEXITCODE): $($output -join ' ')" }
    return @($output)
}

$installer = Get-InstallerFile
$hash = Get-Sha256 $installer.FullName
$assetName = $installer.Name.Replace(' ', '.')
$sumsText = "$hash *$assetName`n"
Test-BuildChecksum $installer.Name $hash

if (-not (Test-Path -LiteralPath $NotesFile)) { throw "the notes file $NotesFile does not exist" }
$notes = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $NotesFile).Path, $Utf8)
if ($notes.Trim().Length -eq 0) { Add-Failure "the notes file $NotesFile is empty" }
Test-UploadText 'the notes' $notes
Test-UploadText 'SHA256SUMS' $sumsText
if ($Failures.Count -gt 0) { throw "publish-release: $($Failures.Count) problems, nothing was sent" }

Write-Host "publish-release: $Tag from $ReleaseDir"
Write-Host "  installer  $($installer.Name) ($($installer.Length) bytes)"
Write-Host "  asset      $assetName"
Write-Host "  SHA256SUMS $($sumsText.TrimEnd())"
Write-Host '  not uploaded: PROVENANCE.json, the measure installer, payload, nsis and config folders'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $WorkRoot "$stamp\stage"
$verify = Join-Path $WorkRoot "$stamp\verify"
$assetPath = Join-Path $stage $assetName
$sumsPath = Join-Path $stage 'SHA256SUMS'
if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $stage, $verify | Out-Null
    Copy-Item -LiteralPath $installer.FullName -Destination $assetPath
    [System.IO.File]::WriteAllText($sumsPath, $sumsText, $Utf8)
    if ((Get-Sha256 $assetPath) -ne $hash) { throw 'the staged copy of the installer differs from the build' }
}

$create = @('release', 'create', $Tag, $assetPath, $sumsPath, '--repo', $Repo, '--draft', '--title', $Title, '--notes-file', (Resolve-Path -LiteralPath $NotesFile).Path)
if ($Target) { $create += @('--target', $Target) }
Invoke-Gh $create | Out-Null

$download = @('release', 'download', $Tag, '--repo', $Repo, '--pattern', $assetName, '--pattern', 'SHA256SUMS', '--dir', $verify, '--clobber')
Invoke-Gh $download | Out-Null
$view = @('release', 'view', $Tag, '--repo', $Repo, '--json', 'assets')
$viewed = Invoke-Gh $view

if ($DryRun) {
    Write-Host "publish-release: dry run, nothing was sent, nothing was written"
    return
}

$delete = "gh release delete $Tag --repo $Repo --yes"
$downloaded = Join-Path $verify $assetName
if (-not (Test-Path -LiteralPath $downloaded)) { throw "the download left no $assetName in $verify; the draft is still there ($delete)" }
$roundTrip = Get-Sha256 $downloaded
if ($roundTrip -ne $hash) { throw "the downloaded $assetName has sha256 $roundTrip, not $hash; the draft is still there ($delete)" }
$sumsBack = Join-Path $verify "SHA256SUMS"
if (-not (Test-Path -LiteralPath $sumsBack) -or ((Get-Sha256 $sumsBack) -ne (Get-Sha256 $sumsPath))) { throw "the downloaded SHA256SUMS differs from the one uploaded; the draft is still there ($delete)" }
$reported = $null
$assets = @()
try {
    $assets = ($viewed -join "`n" | ConvertFrom-Json).assets
    $mine = @($assets | Where-Object { $_.name -eq $assetName })
    if ($mine.Count -eq 1 -and ($mine[0].PSObject.Properties.Name -contains 'digest') -and $mine[0].digest) { $reported = [string]$mine[0].digest }
} catch { $reported = $null }
if ($reported -and $reported -ne "sha256:$hash") { throw "GitHub reports $reported for $assetName, not sha256:$hash; the draft is still there ($delete)" }
$names = @($assets | ForEach-Object { $_.name } | Sort-Object)
if ((($names -join ",") -ne ((@($assetName, "SHA256SUMS") | Sort-Object) -join ","))) { throw "the draft holds $($names -join ', ') instead of $assetName and SHA256SUMS ($delete)" }
Write-Host "publish-release: DRAFT $Tag made; downloaded $assetName again, sha256 $roundTrip matches the build"
Write-Host "publish-release: review the draft in the browser and publish it there; this script never publishes"
