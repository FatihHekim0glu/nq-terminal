# G2 placeholder values for the hand-over documents

## Release 0.1.2 (the 0.1.2 re-measure), values the finisher fills in

The 0.1.2 documents carry the build-dependent values below as visible `{{V012: ...}}` placeholders. The finisher fills them after the 0.1.2 build in the default folder `D:\dev\release\0.1.2` and after the tag, from that folder's `SHA256SUMS` and `PROVENANCE.json`, from `results.md` and `verdict.md` in this folder, and from the install records of the release check. The README release rows keep saying that 0.1.1 is the latest release until the tag exists. A renamed-product installer's hash (the install test builds) is evidence, never an owner value to write.

| Placeholder | Value to write (0.1.2) | Source |
| --- | --- | --- |
| {{V012: installer SHA256}} | the release installer's hash as `SHA256SUMS` lists it, written after the tag | `D:\dev\release\0.1.2\SHA256SUMS` |
| {{V012: installer bytes}} | the size of that file | the same file |
| {{V012: tag and commit}} | `desktop-v0.1.2` and the release commit it names | `PROVENANCE.json`, `git rev-parse desktop-v0.1.2^{commit}` |
| {{V012: commits}} and {{V012: date}} | the commits of this wave and their date, for the commit list of `handover_windows.md` | `git log` |
| {{V012: idle memory}} | idle at HOME, the private working set of the whole tree, taken more than 65 s after HOME is ready, with the private bytes beside it (a trim lowers the working set, not the private bytes); the 400 MB target and the 500 MB ceiling; label PROVISIONAL when the 60 s CPU load was above the plan's limit | `results.md` and `verdict.md` of the 0.1.2 re-measure |
| {{V012: warm rows with and without the trim}} | the warm HOME, EQ and REG rows with the trim on and off (`NQT_MEMTRIM=0`); the trim must not make them slower | the same |
| {{V012: install and upgrade records}} | the dates and step counts of the renamed-product install test and the upgrade scenario, and the `release_check.ps1 -RequireInstall` result | `terminal\state\release`, `checks/2026-10-05_install-upgrade-test.md` |
| {{V012: release check result}} | the `release_check.ps1` result with its date | the release check |

## Release 0.1.1 (the 0.1.1 re-measure of 4 October 2026)

The documents of release 0.1.1 carry three build-dependent values, which the manager filled after the 0.1.1 build in the default folder `D:\dev\release\0.1.1` and after the tag: the installer SHA256 (`3b45f791bc94bf3df3a9e6c3400ff6e56fc289478f651ed59b1e95c013602efc`, from that folder's `SHA256SUMS`), the installer size (3,253,307 bytes, the size of that file) and the tag name (`desktop-v0.1.1`, on commit `777c162`). They stand in the README (status, install table), in `handover_windows.md` (sections 1, 2 and 7) and in `smartscreen.md` (the verification step), and nowhere else. A self-test build's hash or the measuring build's size (3,253,511 bytes, `D:/dev/w6/release-m/0.1.1`) is not a value to write: it would make the owner's check fail. The G2 values below are read from `results.md` (sections A1 to A7) and `verdict.md`.

| Placeholder | Value to write (0.1.1) | 0.1.0 value, history only | Source in this folder |
| --- | --- | --- | --- |
| installer SHA256 | `3b45f791bc94bf3df3a9e6c3400ff6e56fc289478f651ed59b1e95c013602efc`, from `SHA256SUMS` of the final build, written after the tag | `2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590` | `results.md` section A1 |
| installer bytes | 3,253,307 bytes, from the same file | 3,253,432 bytes | `results.md` section A1 |
| idle memory | 477.3 MB (453.0 to 484.4 MB, median of 6 counted launches, smoke build, real data, desktop caps), inside the 500 MB ceiling, 77.3 MB above the 400 MB target | 505.4 MB (492.4 to 508.4 MB), over the ceiling | `results.md` sections A3 and A4 |
| summary of the automated rows and the date | "4 October 2026 (0.1.1 re-measure): AUTOMATED PASS, OWNER ROWS PENDING. Every automated row measured on 0.1.1 is inside its ceiling, whole-app idle memory at HOME (477.3 MB against 500 MB) included. The soak, the simulated minimise and T8 are 0.1.0 readings that were not repeated; the measure-artefact rows and the owner-attended rows are pending." | "4 October 2026 (W5C re-measure): the automated part is not passed. One row is over its ceiling: whole-app idle memory at HOME, 505.4 MB against 500 MB." | `verdict.md` |
| first launch | 3,192.5 ms in the app (smoke build, median of 6, empty state folder; first-launch mode alone 3,183 ms), against the 5,000 ms ceiling and the 4,500 ms first-launch target | 3,167 ms (3,172.5 ms pooled) | `results.md` section A3 |
| usual launch | 2,797 ms in the app (median of 3, state filled) | 2,750 ms | `results.md` section A3 |
| EQ and REG, second run of the line | 38.4 ms and 56.9 ms in the app (medians of 3) | 41.3 ms and 57 ms | `results.md` section A3 |
| soak memory, soak length | not run on 0.1.1; the 0.1.0 reading stands as history | largest sample 705.8 MB, 2 h, PARTIAL | `verdict.md` |
| pending measure-artefact real-lab rows | still pending: port 8765 was listening. The 0.1.1 measure installer is built at `D:/dev/w6/release-m/0.1.1` and is not installed | installed at `D:/dev/w5c/measure/app` | `results.md` section A5 |

## Release 0.1.0 (the W5C re-measure of 4 October 2026), kept as history

The W5B merge copied the first G2 values into the documents that carried the `G2` placeholders (none is left). The W5C re-measure of 4 October 2026 replaces those values: each row below gives the value to write now and keeps the W5B value as history, so the manager can update the documents that quote it. The installer SHA256 and size are not G2 values: they come from `SHA256SUMS` and the file of the final build in the default folder `D:/dev/release/0.1.0` (SHA256 `2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590`, 3,253,432 bytes), because a self-test build's hash would make the owner's check fail. The `W6` placeholders were filled on 4 October 2026. Each value is read from `results.md` or `verdict.md` in this folder. A value that depends on a row that was not measured says so; do not replace those with a number.

| Placeholder | Value to write (W5C) | W5B value, history only | Source in this folder |
| --- | --- | --- | --- |
| installer SHA256 | `2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590`, the final build in `D:/dev/release/0.1.0` (`SHA256SUMS`), written into the documents after the tag | the W5B self-test build gave `6dbf8f49709fca3d7f934e94e88f657de00dad426da49e7df61a39ef4bd2eca0` | `results.md` section 1 |
| installer bytes | 3,253,432 bytes, the final build in `D:/dev/release/0.1.0`, written into the documents after the tag (the W5C measuring build in `D:/dev/w5c/release-m/0.1.0` is 3,253,071 bytes, 3.1 MB, and is not the release) | 3,253,179 bytes | `results.md` section 3 |
| idle memory | 505.4 MB (492.4 to 508.4 MB, median of 6 counted launches, smoke build, real data, desktop caps), against the 500 MB ceiling and the 400 MB target: **over the ceiling by 5.4 MB**. The rows series alone reads 497.1 MB; read by the browser method's 8 second settle it is 453.8 MB; T4 still fires on equal terms (the browser terminal reads 412.5 MB) | 1,082 MB, over the ceiling | `results.md` sections 3 and 9 |
| soak memory | largest sample 705.8 MB (first sample 698.7 MB, median 674.8 MB, +25.9 MB per hour over the last hour), 2 h, PARTIAL, external sampler; inside the 1,500 MB ceiling and the 1,000 MB target | largest sample 1,577.4 MB (the start-up peak), 3 hours, PARTIAL | `results.md` section 8 |
| summary of the automated rows and the date | "4 October 2026 (W5C re-measure): the automated part is not passed. One row is over its ceiling: whole-app idle memory at HOME, 505.4 MB against 500 MB. First-launch cold HOME (3,167 ms), the soak (705.8 MB, 2 h, PARTIAL) and every other measured row are inside their ceilings; the simulated minimise is tested (0 ms); the measure-artefact rows and the owner-attended rows are pending." | "4 October 2026 (night of 3 to 4): not yet passed ..." | `verdict.md` |
| results document | `docs/desktop/g2_windows/results.md` (verdict in `verdict.md`) | the same | |
| measure cold HOME median | pending: the measure artefact's real-lab rows were not run (port 8765 listening). For reference only, on the GNU smoke build: first launch 3,167 ms, usual launch 2,750 ms | pending; smoke build 5,048 ms and 3,321 ms | `results.md` sections 3 and 6 |
| first launch | 3,167 ms in the app (smoke build, median of 3, empty state folder; 3,188 ms in the first-launch series), against the 5,000 ms G2 ceiling and the 4,500 ms first-launch target; 2,700 ms in the stage 1 reading without the shell | 5,048 ms in the app; 4,260 ms in stage 1 | `results.md` sections 3 and 4 |
| usual launch | 2,750 ms in the app (median of 3, state filled); 2,425 ms in the stage 1 reading | 3,321 ms; 3,235 ms | `results.md` sections 3 and 4 |
| volmanaged_v0 EQ warm | 653 ms, the Enter unit, real data, desktop caps (512 MiB bars, 128 MiB files), median of 5; target 1,000 ms, ceiling 1,500 ms; the harness's second run of the same line reads 41.3 ms | 628 ms | `results.md` section 4 |
| overnight soak length | 2 h (harness stopped at 2 h 5 min by the manager; external sampler), PARTIAL | 3 hours, PARTIAL | `results.md` section 8 |
| all-day soak largest sample | not run: an owner check on a day the PC can be left alone | not run | `verdict.md` |
| pending measure-artefact real-lab rows | backend ready, splash, cold HOME and idle memory on the measure artefact (3 runs each), the very first launch after install on it, and the smoke against measure agreement test; skipped because port 8765 was listening (decision 11). The measure build is installed fresh at `D:/dev/w5c/measure/app`; `jobs.json` sha256 was `44CAE38ADB6F6E142C013AC988929B5E12F20363CB82C990A40E77C34B2172D4` and `backtests/output` held 229 entries before and after | the same rows, installed at `D:/dev/d5/measure/app` | `results.md` section 6 |
| provisional rows and their CPU load | none by the CPU gate (every counted run at 4.7% or lower, 2.6 to 4.7%, 0 rejected). Labelled all the same: the quiet slot was the manager's lock, not an owner-named window; the soak is 2 h, PARTIAL, with no harness record (external sampler only) | none by the gate; no owner window; every figure UNREPRODUCED; soak partial | `verdict.md` |

Items for the manager that are not placeholders are in `results.md` section 12.
