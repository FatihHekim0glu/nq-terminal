# The check of the WebView2 bootstrapper that the release installer embeds and runs silently when WebView2 is missing
# (04 D5.4, 03 section 13.1). tauri-bundler downloads MicrosoftEdgeWebview2Setup.exe without a hash or a signature check
# and reuses any file already in its cache folder (a user-writable folder), so build-release.ps1 reads the path from the
# generated installer script and requires a valid Authenticode signature by Microsoft Corporation, the way check.ps1 does
# for WebView2Loader.dll. The record it returns goes into PROVENANCE.json (webview2_bootstrapper).
#
#   powershell -NoProfile -File desktop\scripts\webview2-bootstrapper.ps1 -Path <exe>     JSON record, exit 1 when not valid
#   powershell -NoProfile -File desktop\scripts\webview2-bootstrapper.ps1 -Nsi <installer.nsi>
#   . desktop\scripts\webview2-bootstrapper.ps1                                           (build-release.ps1: the functions only)
[CmdletBinding()]
param(
    [string]$Path,
    [string]$Nsi
)

Set-StrictMode -Version Latest

function Get-BootstrapperPath {
    # The WEBVIEW2BOOTSTRAPPERPATH define of a generated installer script, or $null when it has none.
    param([string]$NsiPath)
    $line = Select-String -LiteralPath $NsiPath -Pattern '^\s*!define\s+WEBVIEW2BOOTSTRAPPERPATH\s+"([^"]+)"' | Select-Object -First 1
    if ($null -eq $line) { return $null }
    return $line.Matches[0].Groups[1].Value
}

function Get-BootstrapperRecord {
    # path, sha256, signature_status, signer and valid (Valid signature, signer O=Microsoft Corporation) of one file.
    param([string]$FilePath)
    $record = [ordered]@{ path = $FilePath; sha256 = $null; signature_status = 'Missing'; signer = $null; valid = $false }
    if (-not $FilePath -or -not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { return [pscustomobject]$record }
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    $record.sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash.ToLowerInvariant()
    $record.signature_status = [string]$signature.Status
    if ($null -ne $signature.SignerCertificate) { $record.signer = $signature.SignerCertificate.Subject }
    $record.valid = ($signature.Status -eq 'Valid') -and ($null -ne $record.signer) -and ($record.signer -match '(^|,\s*)O=Microsoft Corporation(,|$)')
    return [pscustomobject]$record
}

if ($MyInvocation.InvocationName -ne '.') {
    if ($Nsi) { $Path = Get-BootstrapperPath $Nsi }
    $result = Get-BootstrapperRecord $Path
    $result | ConvertTo-Json -Depth 3
    if (-not $result.valid) { exit 1 }
    exit 0
}
