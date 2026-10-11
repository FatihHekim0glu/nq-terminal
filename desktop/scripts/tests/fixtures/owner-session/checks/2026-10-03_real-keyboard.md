# Check: real keyboard (fixture)

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

Press the sixteen keys on a real keyboard and see that each one reaches the page.
A second line of the same paragraph.

Another paragraph that is not part of the purpose line.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installed tag and release commit | {{installed tag and release commit (desktop/scripts/owner-session.ps1 fills this)}} |
| Installer file | {{installer file name of the installed tag (desktop/scripts/owner-session.ps1 fills this)}} |
| Installer size (bytes) | {{installer size in bytes of the installed tag (desktop/scripts/owner-session.ps1 fills this)}} |
| Installer SHA-256 | {{installer SHA-256 from SHA256SUMS of the installed tag (desktop/scripts/owner-session.ps1 fills this)}} |
| Installed executable | {{path of the installed executable (desktop/scripts/owner-session.ps1 fills this)}} |
| Release folder | {{release folder of the installed tag (desktop/scripts/owner-session.ps1 fills this)}} |
| Keyboard (make, layout) | |

## Steps

```powershell
$Terminal = Join-Path $env:USERPROFILE 'nq-lab\terminal'
Get-Content (Join-Path $env:APPDATA 'dev.nqlab.terminal\logs\shell.log') -Tail 20
```

1. [ ] Press F1.

## Pass rule

PASS when 16 of 16 keys work. Keep this line exactly.
