. D:\dev\spikes\env.ps1
$env:CARGO_BUILD_JOBS = '8'
Set-Location D:\dev\spikes\native-egui
$sw = [Diagnostics.Stopwatch]::StartNew()
cargo build --release 2>&1 | Tee-Object D:\dev\spikes\egui-build.log | Select-Object -Last 40
"EXIT $LASTEXITCODE after $($sw.Elapsed)"
