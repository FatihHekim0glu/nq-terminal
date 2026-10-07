# Check: install and upgrade test beside the real install (renamed product)

Result: [x] PASS   [ ] FAIL   Status: RUN (automated, 5 October 2026, before the 0.1.2 release build)

## Purpose

The install test (`desktop/scripts/install-test.ps1`) refused to run on this PC since 0.1.1 was installed, because the installer's registry keys are named after the product: a test install of the real product would repoint the owner's uninstall entry, and the test's uninstall would delete it. The upgrade path itself had never been exercised (handover section 4). This check records the route that needs no administrator and never touches the owner's install:

- **A renamed product.** `desktop/src-tauri/tauri.installtest.conf.json` is a configuration overlay that changes only the product name ("nq-lab terminal installtest") and the identifier (`dev.nqlab.terminal.installtest`). The installer is built from the same `tauri.conf.json`, the same NSIS template and the same hooks (`windows/nsis/hooks.nsh`), so its uninstall key, remembered folder, install folder, `%APPDATA%` and `%LOCALAPPDATA%` folders, shortcuts and Run value are all its own. It does not test the shipped bytes: the release installer differs in those names and in nothing else the script reads.
- **A guard on the real install.** Before and after every run the script hashes the values of `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\nq-lab terminal` and `HKCU\Software\nqlab\nq-lab terminal`, and lists the real install folder (every file with size, time and SHA-256, plus its access list). Any difference fails the run. The real state folder (`%APPDATA%\dev.nqlab.terminal`) is listed too; a change there is reported as a note only, because the owner's running app may write its settings.
- **A refusal.** While the real product is installed or has state on this account, an installer that keeps the real product name or the real identifier is refused before anything is installed.

## How to run it

Build the two renamed installers (each in a temporary detached worktree under `D:\dev\wt`, removed afterwards; the Rust target folder is `D:\dev\targets\v012`; an existing build of the same commit, version and overlay is reused):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\install-test.ps1 -BuildRenamed desktop-v0.1.1
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\install-test.ps1 -BuildRenamed HEAD -BuildVersion 0.1.2
```

`-BuildVersion` was needed tonight only because the tree still carried 0.1.1; once the tree is bumped, `-BuildRenamed HEAD` alone builds 0.1.2. Then the two scenarios:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\install-test.ps1 -Installer 'D:\dev\release-installtest\0.1.2-59c83cec2c\nq-lab terminal installtest_0.1.2_x64-setup.exe' -AllowForeign
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\install-test.ps1 -Upgrade -FromInstaller 'D:\dev\release-installtest\0.1.1-777c162915\nq-lab terminal installtest_0.1.1_x64-setup.exe' -Installer 'D:\dev\release-installtest\0.1.2-59c83cec2c\nq-lab terminal installtest_0.1.2_x64-setup.exe' -AllowForeign
```

The app is never started: only `/R` starts it after an install, and the script never passes `/R`. Every installer runs hidden, with no window, and a global window watch fails the run on any new visible window or change of foreground (`-AllowForeign` turns windows of other programs into warnings; none appeared tonight).

## What the upgrade scenario asserts

Stand-in state is seeded first: `settings.json` and `settings.json.1` under `%APPDATA%\dev.nqlab.terminal.installtest`, a webview stand-in under `%LOCALAPPDATA%\dev.nqlab.terminal.installtest`, and a lab with `terminal\state\workspaces` and `jobs.json` under `D:\dev\tmp\dec1-apps`. Then, each path from a fresh 0.1.1 install with `/S /NS /D=<folder>`:

| Path | Command | Also asserted |
| --- | --- | --- |
| a | `/S /NS /D=<folder>` | first, a file of the user's in the folder makes the 0.1.2 installer refuse with exit code 3 and leaves 0.1.1 as it was |
| b | `/S /NS /UPDATE /D=<folder>` | the quiet mode an updater would use |
| c | `/S /NS` with no `/D=` | the remembered folder is used and nothing lands in the default folders; then 0.1.1 over the top of 0.1.2 (`/S /NS /D=<folder>`) |

After every install, upgrade and downgrade: exit code 0; `DisplayVersion` and `InstallLocation`; the installed exe is the payload exe of that build and carries its product version; the files are exactly those of the old install, so nothing is left over; the folder holds exactly the current user, SYSTEM and Administrators, nothing inherited and no broad writer; no shortcut; no HKLM entry; the app not started; the stand-in state hashes as seeded. After every uninstall: no file left, the uninstall entry gone, the stand-in state unchanged (the silent uninstaller keeps the data). The seeded state, the run folders and the variant's registry keys are removed at the end.

The downgrade result matches handover section 4: an older installer run over a newer install is not stopped, keeps the folder and re-checks it. The handover's recommended rollback (uninstall, then install the older version) is the same pair of steps as paths a to c, so it is covered too.

## Result of 5 October 2026

| Field | Entry |
| --- | --- |
| 0.1.1 renamed installer | built from tag desktop-v0.1.1 (`777c1629150c37bf20e95393566b324df8870424`), 3,253,238 bytes, SHA-256 `99a33fbcae8702f2bac4f424704ba6401f26c3968789378d137a127f58d1f5e6` |
| 0.1.2 renamed installer | built from HEAD `59c83cec2c9eb749dda73fcd4aab6b1e87e0a3ac` with the version set to 0.1.2, 3,253,002 bytes, SHA-256 `a2a535f86edc166e29f126373f2064fade6d7d24b4fe39211545b02a7ecd8ee7` |
| Install scenario | 54 of 54 steps passed (the 52 of the plain test, the renamed-product refusal and the real install guard), 0 window events |
| Upgrade scenario | 105 of 105 steps passed, 0 window events |
| Real install guard | the uninstall key hashed the same before and after both runs, and the real install folder listed the same 4 entries (`%LOCALAPPDATA%\Programs\nq-lab terminal`, 0.1.1) |
| Records | `D:\dev\d5\install\records\2026-10-05_install.json` and `2026-10-05_upgrade.json`, exit code 0, stamped with HEAD `59c83ce` and the working tree of the time |
| Reports | first runs `D:\dev\d5\install\v012-renamed-install.report.json` and `v012-renamed.report.json`; repeated on the final script as `v012-renamed-install-final.report.json` and `v012-renamed-final.report.json`, with the same counts |

These records were written to a scratch folder and are stamped with a tree that other work changed afterwards, so they do not count for the 0.1.2 tag: `release_check.ps1 -RequireInstall` read them and refused them on the provenance stamp alone, which is the intended behaviour.

The records that count for the 0.1.2 tag were written to `terminal\state\release` on 5 October 2026, on the clean release tree: the install test on the renamed product passed 54 of 54 steps and the upgrade scenario 105 of 105, with the owner's real install unchanged, and `release_check.ps1 -Tag desktop-v0.1.2 -RequireSmokeApp -RequireInstall` passed with no WARN and two NOTEs about the renamed-product records.

The records that count for the 0.2.0 tag were written to `terminal\state\release` on 5 October 2026, on the clean 0.2.0 release tree: the install test on the renamed product passed 54 of 54 steps and the upgrade scenario from 0.1.2 to 0.2.0 105 of 105, with the owner's real install unchanged, and `release_check.ps1 -Tag desktop-v0.2.0 -RequireSmokeApp -RequireInstall` passed with no WARN and two NOTEs about the renamed-product records.

The records that count for the 0.2.1 tag were written to `terminal\state\release` on 5 October 2026, on the clean 0.2.1 release tree: the install test on the renamed product passed 54 of 54 steps and the upgrade scenario from 0.2.0 to 0.2.1 105 of 105, with the owner's real install unchanged, and `release_check.ps1 -Tag desktop-v0.2.1 -RequireSmokeApp -RequireInstall` passed with no WARN and two NOTEs about the renamed-product records.

The records that count for the 0.3.0 tag were written to `terminal\state\release` on 7 October 2026, on the clean 0.3.0 release tree: the install test on the renamed product passed 54 of 54 steps and the upgrade scenario from 0.2.1 to 0.3.0 105 of 105, with the owner's real install unchanged, and `release_check.ps1 -Tag desktop-v0.3.0 -RequireSmokeApp -RequireInstall` passed with no WARN and two NOTEs about the renamed-product records.

## The record and the release check

Every run but the self-test and a build writes `<date>_install.json` or `<date>_upgrade.json` (default folder `terminal\state\release`). Each holds the version, product, identifier, the installer's name and SHA-256 (and the old installer's for an upgrade), the steps passed and failed, the real install guard's result and the provenance stamp (`record_green.ps1 -Stamp`). `scripts\release_check.ps1 -RequireInstall` refuses a tag unless, for each scenario, one record says exit code 0, at least one step and none failed, this PC, the tag's version (for an upgrade, an old version below it), the real install untouched, the current stamp, and an installer SHA-256 equal to an installer at the top of the release folder, hashed when the check runs. A renamed-product record is accepted with a note that it ran the same NSIS script and hooks, not the shipped bytes.

## Not covered

- The shipped bytes of the real product on this PC: the owner's install is never touched by a test. The owner's own upgrade from 0.1.1 is `desktop/scripts/upgrade-owner.ps1` (backup, verify and rollback), run by the owner.
- A GUI install (the reinstall page with "uninstall before installing"): every run here is silent.
