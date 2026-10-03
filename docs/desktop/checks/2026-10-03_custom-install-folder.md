# Check: install into a custom folder

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

Decision 1.3 of the register (`docs/desktop/owner_decisions_windows.md`, "Install folders") says the installer follows the per-user pattern of VS Code user setup and Chrome per-user installs, and closes two weaknesses: an executable that other local accounts can replace (CWE-732, incorrect permission assignment) and a folder that a lower-privileged process can plant files in (CWE-427, uncontrolled search path). In practice: the default folder is under `%LOCALAPPDATA%\Programs`; any folder you choose gets a protected access list (your account plus SYSTEM and Administrators, nothing inherited) before a single file is written; drive roots, network paths, Program Files and the Windows folder are refused; nothing asks for elevation.

This check proves that on the real installer, by hand, in the one case the automated install test cannot cover: a folder you pick on a drive whose parent grants wide rights. On this PC, `D:\` grants Authenticated Users Modify with inheritance, so an install under `D:\Apps` is the case that matters.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installer file | `nq-lab terminal_0.1.0_x64-setup.exe` |
| Installer size (bytes) | {{G2: installer bytes}} |
| Installer SHA-256 | {{G2: installer SHA256}} |
| Release commit | {{W6: final release commit}} |
| Folder chosen | `D:\Apps\nq-lab terminal` (or your own) |

## Preconditions

- The app is not installed, or you have uninstalled it (step 9 of this check covers uninstalling).
- You are signed in as your normal account, not an administrator shell. A UAC prompt at any point is a FAIL.
- The browser terminal and the app are both closed, so no backend holds the lab.
- For steps 7 and 8, start from a first launch. The app logs the WebView2 data folder as protected only when that launch creates the folder, and it shows the lab picker only when it has no saved lab. If you ran the app before (the README order does that first), move both aside, which keeps them recoverable:

  ```powershell
  $Cfg = Join-Path $env:APPDATA 'dev.nqlab.terminal'
  $Stamp = Get-Date -Format yyyyMMdd-HHmmss
  Rename-Item -LiteralPath "$Cfg\settings.json" -NewName "settings.json.aside-$Stamp" -ErrorAction SilentlyContinue
  Rename-Item -LiteralPath 'D:\nq-terminal\webview' -NewName "webview.aside-$Stamp" -ErrorAction SilentlyContinue
  ```

  Moving the settings aside also drops your saved lab, so you pick it again; restore the `.aside` names afterwards if you want the old state back. If you would rather keep your settings, skip this and read the two cases written under steps 7 and 8.

## Steps

1. [ ] Verify the installer against the checksum list. Both lines must show the same hash as the table above (case does not matter).

   ```powershell
   $Release = 'D:\dev\release\0.1.0'
   (Get-FileHash -Algorithm SHA256 -LiteralPath "$Release\nq-lab terminal_0.1.0_x64-setup.exe").Hash
   Select-String -LiteralPath "$Release\SHA256SUMS" -SimpleMatch 'nq-lab terminal_0.1.0_x64-setup.exe'
   ```

2. [ ] Double-click the installer. Expected: no UAC prompt, a wizard with a folder page. Write down the folder it offers: it must be `%LOCALAPPDATA%\Programs\nq-lab terminal` (that is `C:\Users\<you>\AppData\Local\Programs\nq-lab terminal`, the product folder name of the installer script).
3. [ ] On the folder page, type each path below in turn. Expected for every one: the installer's Install button stays greyed out and nothing is installed. The folder page shows no explanation for a refused folder, so write down only whether the button was greyed out. (The explanatory words appear on the console of a silent install and in a dialog if the guard stops an install after it began; they are listed in register entry 1.3.) If the button is enabled for any of these, that is a FAIL: do not press it unless you want the install.

   | Path typed | Install greyed out (tick) | Anything else you saw |
   | --- | --- | --- |
   | `D:\` (a drive root) | [ ] | |
   | `\\localhost\nq-lab-test\nq-lab terminal` (a network path) | [ ] | |
   | `C:\Program Files\nq-lab terminal` | [ ] | |
   | `C:\Windows\nq-lab terminal` | [ ] | |

   The automated install test covers the same four cases silently (a drive root in three spellings, a network path, Program Files and the Windows folder, each with exit code 3) and a junction as well; this by-hand step is the check that the folder page itself refuses them.

   After this step, confirm nothing was written by any of them: `Test-Path 'C:\Program Files\nq-lab terminal'` and `Test-Path 'C:\Windows\nq-lab terminal'` must both print False.
4. [ ] Type your custom folder (for example `D:\Apps\nq-lab terminal`) and install. Expected: it completes with no UAC prompt and no second window. If Install is greyed out for your own folder, the folder is refused: its parent grants another account the right to rename or re-protect it, the folder already exists and holds files that are not this program's, or another account owns it. Read the parent's list with `icacls` (for `D:\Apps` that is `icacls 'D:\Apps'`), write what you find in the findings, and pick another folder; do not widen any permission. A parent that only lets Authenticated Users add and change files (Modify), as `D:\` does on this PC, is accepted by the installer, but Modify includes DELETE, so another account could rename that parent away and plant its own program folder. Write in the findings whether this PC has only your own account (then a `D:\` child folder is fine, a single-account PC); if it has others, use the profile default or protect the parent first.
5. [ ] Read the folder's access list straight after the install.

   ```powershell
   $Dir = 'D:\Apps\nq-lab terminal'
   $acl = Get-Acl -LiteralPath $Dir
   'protected: ' + $acl.AreAccessRulesProtected
   $acl.Access | Select-Object IdentityReference, FileSystemRights, IsInherited | Format-Table -AutoSize
   icacls $Dir
   ```

   Expected: `protected: True`; the only identities are your own account, `NT AUTHORITY\SYSTEM` and `BUILTIN\Administrators`; no entry is inherited from the drive; there is no entry for Everyone, `BUILTIN\Users` or `NT AUTHORITY\Authenticated Users`.
6. [ ] Read who can reach every installed file. A file inside a protected folder inherits the folder's three entries, so `IsInherited` is True for those files and that is correct; the point is the list of identities.

   ```powershell
   Get-ChildItem -LiteralPath $Dir -Recurse -File |
     ForEach-Object { (Get-Acl -LiteralPath $_.FullName).Access.IdentityReference.Value } |
     Sort-Object -Unique
   ```

   Expected: exactly your account, `NT AUTHORITY\SYSTEM` and `BUILTIN\Administrators`. The program `nq-lab-terminal.exe`, `WebView2Loader.dll` and the uninstaller must all be among the files listed.
7. [ ] Start the app from the Start menu. Expected after the clean start above: the first-run lab picker (it proposes `%USERPROFILE%\nq-lab`); pick your lab; HOME opens with data. If you kept your earlier settings, no picker appears and HOME opens with data; that is also a pass for this step.
8. [ ] Confirm the app made its WebView2 data folder with a protected access list. The shell log records it as a `data_dir` event.

   ```powershell
   $Cfg = Join-Path $env:APPDATA 'dev.nqlab.terminal'
   Test-Path "$Cfg\logs\shell.log"
   Get-Content -LiteralPath "$Cfg\logs\shell.log" |
     ForEach-Object { $_ | ConvertFrom-Json } |
     Where-Object event -eq 'data_dir' | Select-Object -Last 1 | Format-List path, protected
   ```

   Expected after the clean start (the launch created the folder): `created : True` and `protected : True`. If the folder already existed, the app leaves it as it was and logs `created : False` and `protected : False`; that value says nothing about the access list, so do not record it as a failure. In both cases run the step 5 commands with `$Dir` set to the `path` it printed. That result decides the step: protected, and only the same three identities.
9. [ ] Close the app, then uninstall it from Settings, Apps, or with the uninstaller in the install folder. Expected: no UAC prompt; the install folder is gone (it stays, with only your own file in it, if you added a file there: the uninstaller removes only what the installer wrote); the lab and its `terminal\state` folder are untouched (the uninstaller never touches them, 03 section 13.1). Then list what it left behind:

   ```powershell
   Test-Path 'D:\Apps\nq-lab terminal'
   Test-Path (Join-Path $env:USERPROFILE 'nq-lab\terminal\state')
   Get-Item 'HKCU:\Software\nqlab\nq-lab terminal' -ErrorAction SilentlyContinue
   ```

   The build's own install test records that the uninstaller leaves the registry key `HKCU\Software\nqlab\nq-lab terminal`. The "delete app data" box, if you tick it, removes only `%APPDATA%\dev.nqlab.terminal` and `%LOCALAPPDATA%\dev.nqlab.terminal`. The WebView2 data folder you chose (`D:\nq-terminal\webview`) is never removed by the uninstaller, so delete it by hand if you want it gone; it is not a finding that it is still there. Anything else left behind, apart from the registry key, the WebView2 folder and (with the box unticked) the two `dev.nqlab.terminal` folders, is a finding.

## Pass rule

PASS when steps 1 to 9 are all ticked, every refused path in step 3 had its Install button greyed out, no UAC prompt appeared at any point, the folder and the WebView2 data folder have protected access lists with only the three identities, and the uninstall left the lab untouched. Any one miss is a FAIL.

## Evidence to keep

Save in `D:\dev\d5\owner-evidence\<date>_custom-install-folder\`: a screenshot of the folder page offering the default, one screenshot per refusal in step 3, the text output of steps 5 and 6, and of step 8 (copy it from the console), and the output of step 9.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

Write here anything that surprised you, including wording you would change.
