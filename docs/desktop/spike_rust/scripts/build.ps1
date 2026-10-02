. D:\dev\spikes\env.ps1
Set-Location D:\dev\spikes\tauri-shell
$sw = [Diagnostics.Stopwatch]::StartNew()
pnpm dlx @tauri-apps/cli@latest build --verbose
"EXIT $LASTEXITCODE after $($sw.Elapsed)"
