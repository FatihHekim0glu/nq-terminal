# w0-owner-pack, slice owner-session

Slice of wave w0-owner-pack (V04). It adds the owner's guided session script and its tests.

## What it does

`desktop/scripts/owner-session.ps1` takes the owner through the checks of `docs/desktop/checks/session_order.json` for one installed version. For each step, in the order of that file, it prints the purpose, the owner time and the copy-paste commands, then copies the step's template to `docs/desktop/checks/YYYY-MM-DD_<check>.md` with the version facts filled in.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\owner-session.ps1 -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\owner-session.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\owner-session.ps1 -Only nvda,narrator
```

| Parameter | Meaning |
| --- | --- |
| `-Version x.y.z` | The version to prepare. Default: `DisplayVersion` of the HKCU uninstall entry `nq-lab terminal` (read only). |
| `-Only a,b` | Only these checks, still in the order of the list. A name that is not in the list is refused. |
| `-Sums <path>` | The `SHA256SUMS` file. Default: `D:\dev\release\<version>\SHA256SUMS`. |
| `-DryRun` | Prints exactly the steps and what it would write. Writes nothing. A missing tag or sums line is a warning here, an error in a real run. |
| `-Order <path>` | The session list. Default: `docs/desktop/checks/session_order.json`. |
| `-Date YYYY-MM-DD` | The date of the records. Default: today. |

Hooks used by the tests only: `-ChecksDir` (accepted only under `D:\dev\tmp`, with a warning), `-RepoRoot`, `-ReleaseRoot`, `-UninstallRoot`.

### Facts filled in

- The tag `desktop-v<version>` and its commit: `git rev-parse --verify refs/tags/desktop-v<version>^{commit}`, read only. No tag is an error (exit 2) before anything is written.
- The installer SHA-256: the line for `nq-lab terminal_<version>_x64-setup.exe` in the sums (the installtest and measure installers are not taken). No line is an error (exit 2).
- The installer file name, its size in bytes (the file beside the sums, when it is there), the release folder, the installed executable's path (from `InstallLocation` of the uninstall entry), and the run date.
- Every `{{ ... (desktop/scripts/owner-session.ps1 fills this)}}` marker of the templates whose description it knows is replaced, braces included. A marker whose fact cannot be read stays as it is and the step prints a warning with the count. Older style rows (an empty `Run date`, `Installer SHA-256` or `Release commit` cell, or one holding a bare hash) are filled too. A line saying the record was pre-filled, with the version, tag, commit and hash, is added under the title.

### What it refuses and never does

- A record that exists is never overwritten: the file is created with `CreateNew`, the step is reported `REFUSED` and the run ends with exit code 1 after the other steps were handled. A record dated like its template (same file) is refused with a message that says so.
- Templates and records must be direct children of the checks folder; a name that climbs out of it, a sub-folder, an absolute path or a path that cannot be resolved fails the preflight (exit 1) and nothing at all is written.
- A missing template fails the preflight the same way.
- It never launches the app, never closes or stops a process, never runs `close-app.ps1`, never contacts IB, TWS or QuantPad, never touches port 8765, and writes nothing outside the checks folder. The tests scan the script text for those words.

Exit codes: 0 done; 1 a record refused or a template or target unusable; 2 unusable input (version, tag, sums, order file, `-Only` name, test hook).

### Session list format

```json
{ "steps": [ { "id": "nvda", "template": "2026-10-03_nvda.md", "owner_minutes": 15 } ] }
```

The check name is read from `check`, `name` or `id` (else derived from the template file name); the owner time from `minutes`, `owner_minutes` or `owner_time`; the template from `template` or `file`. `purpose` and `commands` are optional: without them the first paragraph of the template's `## Purpose` and its fenced `powershell` blocks are printed. A bare array also works. A list that is empty, is not JSON, or names a check twice is refused. The number of steps is never fixed in the script.

## Tests

`powershell -NoProfile -ExecutionPolicy Bypass -File desktop/scripts/tests/owner-session.tests.ps1`, in the style of `install-test.tests.ps1`: 71 checks over a fixture list and three fixture templates (`desktop/scripts/tests/fixtures/owner-session/`), a scratch folder under `D:\dev\tmp\v04-w0`, the existing tag `desktop-v0.3.2` (read only), a fake registry root and a fake release folder. Born-failing evidence (run against a script that copies without any guard): 35 of 54 checks failed at that stage, including each of the five named cases. The regression guards (they pass on the naive script by construction): the forbidden-word scan of the script text, the 800-line limit and the real checks folder staying free of test-dated files.

## New files and their fate (for the 03 Appendix A addendum)

| File | Lines | Fate |
| --- | ---: | --- |
| `desktop/scripts/owner-session.ps1` | 423 | new: the owner's guided session script |
| `desktop/scripts/tests/owner-session.tests.ps1` | 296 | new: its born-failing tests |
| `desktop/scripts/tests/fixtures/owner-session/session_order.json` | 9 | new: three-step fixture list |
| `desktop/scripts/tests/fixtures/owner-session/SHA256SUMS` | 4 | new: fixture sums (installer, installtest, measure and payload lines) |
| `desktop/scripts/tests/fixtures/owner-session/checks/` | 3 files | new: fixture templates (braced markers, empty rows, the older bare-phrase style) |
| `docs/desktop/v04/w0-owner-pack__owner-session.md` | this file | new: slice note |

## Facts for the merge step

- The real `session_order.json` (written by checks-refresh) uses `id` and `owner_minutes`; the script reads both. A dry run over it with `-Version 0.3.2 -Sums <fixture sums>` prints 14 steps and 210 minutes, and a run into a scratch copy of the real checks folder fills every marker of every template (0 fill-in markers left over, 0 warnings).
- The four templates dated 2026-10-11 collide with a record dated 2026-10-11 (same file name), so on 11 October itself those four steps are refused and the template is untouched. From 12 October on there is no collision. This is by design (a template is never overwritten); nothing to change unless the owner wants to run on 11 October, in which case `-Date` can be passed.
- Not verified: a run on the owner's PC against the real installed version and `D:\dev\release\0.3.3` (no tag `desktop-v0.3.3` existed in this worktree when the slice ended, so the 0.3.3 case was only checked with 0.3.2).

## Changes made after the first write (release check)

Three fixes landed in `owner-session.ps1` and its tests before the release check: a dry run now counts and exits on records it would refuse (`would-refuse`) and prints a hint with the next free `-Date` when a record name equals its own template; the requested version must match the uninstall entry's `DisplayVersion` unless `-AllowVersionMismatch` is given (the record then names the installed version); and a record is written to a hidden temp file and moved into place, so a failed write leaves no partial record and is reported as FAILED, not REFUSED. The summary reads `N written, N refused, N failed, N steps`. The tests now hold 71 checks.
