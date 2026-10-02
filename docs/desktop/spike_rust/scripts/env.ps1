# Dot-source: . D:\dev\spikes\env.ps1   (this process only; no permanent PATH or profile change)
$env:RUSTUP_HOME = 'D:\dev\rustup'
$env:CARGO_HOME  = 'D:\dev\cargo'
$env:CARGO_TARGET_DIR = $null
$env:PATH = 'D:\dev\cargo\bin;D:\dev\mingw\mingw64\bin;' + $env:PATH
$env:npm_config_cache = 'D:\dev\npm-cache'
$env:npm_config_store_dir = 'D:\dev\pnpm-store'
$env:TEMP = 'D:\dev\tmp'; $env:TMP = 'D:\dev\tmp'
New-Item -ItemType Directory -Force D:\dev\tmp | Out-Null
