# SmartScreen and the unsigned installer

Status: brought in line with the tree at commit `f2e03bf` on 3 October 2026, for the Windows hand-over (D6). The installer is unsigned by decision (see the last section). The facts about this PC were read on 3 October 2026 (at 23:26 local time) with read-only commands, and the table below gives the results. The figures of each final build were filled in after its tag (section 10 of `handover_windows.md`); none is left as a placeholder. The licence, the signing routes and the Microsoft Store route were brought up to date on 5 October 2026.

## What SmartScreen does with this installer

SmartScreen is Windows' reputation check for downloaded programs. It only looks at a file that carries the Mark of the Web, a hidden `Zone.Identifier` stream that a browser, a mail client or an unpacking tool adds to files that came from another place. A file with no mark is never judged by SmartScreen.

The installer is `nq-lab terminal_0.1.2_x64-setup.exe` (0.1.0 and 0.1.1 behaved the same way). It has no Authenticode signature, so Windows has no publisher name and no certificate to build a reputation on. What you see depends on how the file reached the PC:

| How the file reached this PC | Mark of the Web | What Windows shows |
|---|---|---|
| Built here and copied from `D:\dev\release\0.1.2` | none | Nothing from SmartScreen. The installer runs per user and asks for no administrator rights, so there is no permission prompt either. |
| Downloaded through a browser, for example a CI artefact or a release page | yes | One blue dialog, "Windows protected your PC", with "Unknown publisher". |
| Copied from a USB stick or a network share that the browser or archive tool marked | depends on the tool | As the row above if the mark survived. |

A downloaded copy shows the prompt once per file. A new build is a new file, so every new installer starts again from zero reputation, signed or not (03 section 13.1, research L4 section 4.1).

### State on this PC at review time

The table below is the record of 3 October 2026, made on the 0.1.0 builds. The commands work unchanged on the 0.1.2 installer once the path names `D:\dev\release\0.1.2` and the 0.1.2 file name.

| Question | Command (read-only) | Result on 3 October 2026 |
|---|---|---|
| Does the local installer carry the mark? | `Get-Item -LiteralPath 'D:\dev\release\0.1.0\nq-lab terminal_0.1.0_x64-setup.exe' -Stream *` | One stream, `:$DATA`, 3,253,317 bytes (the older build that the folder held at review time; see below). No `Zone.Identifier`, so SmartScreen is not invoked for this copy. The same command on the reference build of `f2e03bf`, `D:\dev\release-b\0.1.0\nq-lab terminal_0.1.0_x64-setup.exe`, gave the same result: one stream, 3,253,192 bytes. |
| Is it signed? | `Get-AuthenticodeSignature -LiteralPath 'D:\dev\release\0.1.0\nq-lab terminal_0.1.0_x64-setup.exe'` | `NotSigned`, for both copies. |
| Is Smart App Control on? | `reg query "HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy" /v VerifiedAndReputablePolicyState` | `0x0`, which is off. (`1` is on, `2` is evaluation mode.) |
| Windows build | `[System.Environment]::OSVersion.Version.ToString()` | 10.0.26300.0 |

Smart App Control matters more than SmartScreen. When it is on it can refuse an unsigned program outright, with no "Run anyway" button, and it judges every program, not only downloads. It is off here. If a later Windows update or a reset turns it on, the unsigned installer and the unsigned app will not run, and the only fixes are to turn Smart App Control off or to sign the build (see below). Re-read the registry value at the start of every dual-run week: it costs one command.

The readings above were made on two builds. `D:\dev\release\0.1.0` held a build from `e0834c1`, and `D:\dev\release-b\0.1.0` holds the reference build of `f2e03bf`. The default folder holds the final build, made from the release commit `8122c87`, so the 0.1.0 installer you verified was that one: `2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590`, size `3,253,432` bytes. The 0.1.1 installer was 3,253,307 bytes, SHA256 `3b45f791bc94bf3df3a9e6c3400ff6e56fc289478f651ed59b1e95c013602efc` (history). The 0.1.2 installer is 3,254,474 bytes, SHA256 `3ab330927d6b1e1c617163a5ff8089baae8e2da4ac553b2b6527cedf4569f377`. A rebuild changes the hash every time. The mark reading does not depend on the build: a file made on this PC and copied by this PC carries no mark, whichever build it is.

## Verify the installer before you run it

Do this for any copy that did not come straight from the build folder on this PC, and do it before you click "Run anyway".

1. Compute the hash of the file you hold:

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\dev\release\0.1.2\nq-lab terminal_0.1.2_x64-setup.exe' | Format-List Algorithm,Hash
   ```

   Change the path to wherever your copy is. PowerShell prints the hash in capitals; the checksum file uses lower case. Compare without regard to case.

2. Compare it with the expected value, which must come from a place other than the copy itself:
   - `SHA256SUMS` in the build folder (`D:\dev\release\0.1.2\SHA256SUMS`), read on the PC that built it;
   - the value in the hand-over note, `3ab330927d6b1e1c617163a5ff8089baae8e2da4ac553b2b6527cedf4569f377` (the 0.1.1 installer gave `3b45f791bc94bf3df3a9e6c3400ff6e56fc289478f651ed59b1e95c013602efc`, the final 0.1.0 installer gave `2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590` and the 0.1.0 build from `49229b9` gave `c568be92eb49bf814f2c151ace6631b11032050f2b6028bf3b0c183a27f90e58`, and this changes with every rebuild);
   - `PROVENANCE.json` in the same folder names the version, the commit (`head`) and the tools; it must name the commit that the tag desktop-v0.1.2 names (for 0.1.0 it was `8122c877bb00e4f07ce505d5ba0468d6a9858f41`).
   - the release page of the public repository. GitHub turns the space of an uploaded file name into a dot, so the asset is `nq-lab.terminal_0.1.2_x64-setup.exe`, and the published `SHA256SUMS` lists that dotted name with the same hash. A copy saved under the dotted name is the same file; compare the hash, not the name. `desktop\scripts\upgrade-owner.ps1` reads `SHA256SUMS` either way.

3. If the two hashes differ by even one character, stop. Delete the copy and fetch it again from the build folder. Do not click through the prompt.

4. Optional: `Get-AuthenticodeSignature` should say `NotSigned`. A signature that names a publisher you do not know on a build that you made yourself is a reason to stop.

The hash proves that the file is the one that was built. It does not prove that the build is trustworthy; that rests on the build being made from the committed tree (the provenance stamp in `PROVENANCE.json` and the release check bind the two).

## How to proceed safely when the prompt appears

1. Verify the hash first (above).
2. In "Windows protected your PC", read the line that says "Unknown publisher" and the file name. It must be the file you verified.
3. Choose "More info". The "Run anyway" button only appears after that.
4. Choose "Run anyway". The installer is per user: it writes only to your own folders and asks for no administrator rights. If any dialog asks for administrator rights, stop and cancel it. The installer never needs them, and a prompt for them means something else is running.
5. Install into a folder that only you can write to. The runbook ([handover_windows.md](handover_windows.md), sections 2 and 6) gives the default folder, the folders the installer refuses, and the permission check to run afterwards.
6. Keep the record of the first run (next section).

Do not use the other route, unblocking the file in its Properties dialog or with `Unblock-File`, unless you have already verified the hash. It removes the mark and the prompt, so it also removes the only moment at which Windows asks you to look again.

## The record to keep of the first-run prompt

The first time the installer is run from a downloaded copy, and the first time after any Windows feature update, write down what Windows did. The owner check [checks/2026-10-03_smartscreen-first-run.md](checks/2026-10-03_smartscreen-first-run.md) is the template: copy it to `docs/desktop/checks/YYYY-MM-DD_smartscreen-first-run.md` with the date of the run and fill it in. Add this table to its findings section, because it holds the fields about the download that the template does not ask for:

| Field | Entry |
|---|---|
| Date and time | |
| Windows version (`winver`, or the command above) | |
| Installer file name | |
| SHA256 computed | |
| SHA256 expected, and where it came from | |
| Hashes equal (yes or no) | |
| How the copy reached the PC | |
| `Get-Item -Stream *` on the copy (does `Zone.Identifier` appear?) | |
| Smart App Control value (`VerifiedAndReputablePolicyState`) | |
| Dialog shown (exact title and the publisher line) | |
| Buttons offered before and after "More info" | |
| What you chose | |
| Any administrator prompt (expected: none) | |
| Install folder chosen, and the result of the permission check | |
| Outcome (installed and started, refused, stopped by you) | |
| Notes | |

A refusal with no "Run anyway" button is the Smart App Control case: record it, do not search for ways round it, and decide on signing (below).

## How reputation and signing change this

Signing does not make the prompt disappear at once. SmartScreen weighs the publisher's certificate and the file's own hash. A newly signed file still warns until reputation builds, which Microsoft says can take several weeks and many clean installs from a wide audience (research L4 section 4.1). With one user, a signed build would probably keep warning for a long time; that is an inference, not a measurement.

| Route | Cost (research L4, 2026 figures) | Who can have it | Effect on SmartScreen |
|---|---|---|---|
| Unsigned (today) | none | anyone | prompt on every downloaded file; refused outright if Smart App Control is on |
| OV or IV certificate for an individual: Certum's cloud code signing for an individual developer, or SSL.com IV | Certum: about 139 US dollars a year before VAT through a reseller (Certum's own shop lists its Standard cloud certificate from 209 euros without saying who may buy it); SSL.com IV: 129 US dollars a year plus eSigner cloud signing from 20 US dollars a month, or a hardware token | a UK individual: a reseller sells Certum's variant "intended exclusively for individual software creators", and SSL.com sells IV certificates to individuals | the publisher name shows; the prompt stays until reputation builds. Keys must sit in hardware or a cloud key store, and a certificate lasts at most 459 days (Certum, from 27 February 2026) |
| EV certificate | about 329 to 379 euros a year | organisations | no advantage over OV for SmartScreen any more; Microsoft says paying for EV only to avoid the prompt is no longer justified |
| Azure Artifact Signing (formerly Trusted Signing) | from about 9.99 US dollars a month | organisations in the US, Canada, the EU and the UK; individuals only in the US or Canada (Microsoft Learn quickstart, updated 29 September 2026), so not the owner as a private person | the same as OV: reputation builds over time. Needs a paid Azure subscription and identity checks of 1 to 20 working days |
| Microsoft Store, EXE listing | free developer account | anyone who passes the identity checks | no SmartScreen prompt for Store installs, but the Store requires the EXE to be code signed and the WebView2 offline installer mode, which grows the installer from about 3 MB to well over 100 MB. It does not avoid buying a certificate |
| SignPath Foundation | free | open-source projects with an OSI licence | the same as OV. The repository's `LICENSE` is all rights reserved (published for viewing and evaluation only), not an OSI licence, so it does not qualify |

Signing also changes Smart App Control: a signed build from a certificate Windows trusts is allowed to run when Smart App Control is on, an unsigned one is not.

Recommendation: stay unsigned while the owner is the only user and Smart App Control is off. Buy or arrange a certificate only when a second person needs to install the app, or if Smart App Control gets switched on. The cheapest workable route for a UK individual is then an individual OV or IV certificate (Certum's cloud variant or SSL.com IV); Artifact Signing is open to the owner only through a company, so it is worth it only if a company is formed for other reasons. Open decision; see [owner_decisions_windows.md](owner_decisions_windows.md), section 3, item 1.

## The owner's unsigned decision

- The 0.1.0 release is unsigned, and so is 0.1.1; 0.1.2 stays unsigned too, on the recommended default taken as a provisional owner decision. This is a choice made for the first build, recorded here, and not an oversight.
- Its reasons: one user on a PC where the build is made, no reputation to gain from a certificate with one user, and a cost and an identity process that give nothing yet.
- What it costs: a prompt on every downloaded installer, and a hard stop if Smart App Control is ever switched on.
- What it does not change: the installer is per user, needs no administrator rights, writes nothing under the lab, and is covered by the same checks as a signed build (artefact check, silent install test, release check).
- When to reopen it: a second user, a Smart App Control change, or the first public download. The decision is open for the owner and the recommended default is "stay unsigned for 0.x".
