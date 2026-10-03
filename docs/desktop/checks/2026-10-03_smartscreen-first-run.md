# Check: SmartScreen first run

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

The installer is unsigned, by decision (the register, "Still open": code signing and SmartScreen reputation). What Windows does with an unsigned installer depends on where the file came from, and the plan (03 section 13.1) makes three claims that this check turns into observations on this PC:

1. An installer built and copied locally has no Mark of the Web, so SmartScreen is not invoked and no prompt appears.
2. The same file after a download carries the mark, and Windows shows one "Run anyway" prompt for each such file.
3. Smart App Control, which blocks unsigned programs outright when it is on, is off on this PC.

`docs/desktop/smartscreen.md` holds the reasoning and the reading made at review time. This file is the owner's own run of it. It is a record of behaviour, not a gate on the app: the app does not change.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installer | `nq-lab terminal_0.1.0_x64-setup.exe`, {{G2: installer bytes}} bytes |
| Installer SHA-256 | {{G2: installer SHA256}} |
| Release commit | {{W6: final release commit}} |
| Windows build | |
| Browser used for the real download in step 6 (if you do it) | |

## Steps

1. [ ] Read the streams of the local installer. A downloaded file has a second stream named `Zone.Identifier`; a local build has only the main data stream.

   ```powershell
   $Release = 'D:\dev\release\0.1.0'
   Get-Item -LiteralPath "$Release\nq-lab terminal_0.1.0_x64-setup.exe" -Stream * | Select-Object Stream, Length
   ```

   Expected: one row, `:$DATA`, with the installer's size. Record what you see below.
2. [ ] Read Smart App Control's state from the registry (read only). `0` is off, `1` is on, `2` is evaluation mode.

   ```powershell
   (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState).VerifiedAndReputablePolicyState
   ```

   Expected: `0`. If it is `1`, an unsigned app is blocked with no "Run anyway" and the unsigned decision has to be reopened: stop, record it, mark the check FAIL.
3. [ ] Local installer: if you installed from the release folder in another check, tick this when no SmartScreen window appeared at the double-click. Otherwise double-click the installer from the release folder now and look. Expected: the installer's own wizard opens, nothing from SmartScreen. (Do not install a second copy; close the wizard at its first page if you already have one.)
4. [ ] Make a marked copy, which stands in for a browser download. The copy goes to your evidence folder, never over the original.

   ```powershell
   $Ev   = 'D:\dev\d5\owner-evidence\<date>_smartscreen-first-run'
   New-Item -ItemType Directory -Force -Path $Ev | Out-Null
   $Copy = Join-Path $Ev 'nq-lab terminal_0.1.0_x64-setup.exe'
   Copy-Item -LiteralPath "$Release\nq-lab terminal_0.1.0_x64-setup.exe" -Destination $Copy
   Set-Content -LiteralPath $Copy -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3"
   Get-Item -LiteralPath $Copy -Stream * | Select-Object Stream, Length
   ```

   Expected: two rows, `:$DATA` and `Zone.Identifier`.
5. [ ] Double-click the marked copy. Write down everything the first window says: the title, the headline, the publisher line, the buttons. Expected: Microsoft Defender SmartScreen shows a window that says Windows protected your PC (or an equivalent headline) with an unknown publisher. Choose More info, then Run anyway. Count the prompts: expected one. The installer then opens. Close it at its first page unless you want to install.
6. [ ] Optional, the real thing: put the installer where a browser can download it (your own cloud folder, for example), download it with your browser, and repeat step 5 on the downloaded file. Record whether the prompt matches step 5. The reputation service can answer differently for a real download, so a difference is worth writing down, not a failure.
7. [ ] If you installed from the marked copy: confirm the installed program carries no mark, then start it. Expected: no second prompt, because an installer's output files do not inherit the mark.

   ```powershell
   Get-Item -LiteralPath '<your install folder>\nq-lab-terminal.exe' -Stream * | Select-Object Stream, Length
   ```

8. [ ] Clean up. Delete the marked copy, and uninstall the app if you installed only to test:

   ```powershell
   Remove-Item -LiteralPath $Copy
   ```

## Readings

| Observation | Expected | What you saw | Matches |
| --- | --- | --- | --- |
| Streams of the local installer | `:$DATA` only | | [ ] |
| Smart App Control state | 0 (off) | | [ ] |
| Prompt at the local installer | none | | [ ] |
| Prompts at the marked copy | one, with Run anyway | | [ ] |
| Wording of the prompt (headline and publisher line) | for the record | | |
| Streams of the installed program, if installed | `:$DATA` only | | [ ] |
| Prompt at the first start of the installed app | none | | [ ] |

## Pass rule

PASS when every row with an "expected" value matches and steps 1 to 8 are done. If Smart App Control is on, or the prompt has no Run anyway, or the installed program prompts again, the check is a FAIL and the unsigned decision is reopened: a Certum OV certificate (from EUR 209 a year) is then needed even for your own use. Say so in the findings.

## Evidence to keep

Save in `D:\dev\d5\owner-evidence\<date>_smartscreen-first-run\`: a screenshot of the prompt (before and after More info) and the console output of steps 1, 2, 4 and 7. Do not keep the marked copy once the check is done.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

Anything you would want the next person to know before they click Run anyway on this installer.
