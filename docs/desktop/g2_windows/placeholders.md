# G2 placeholder values for the hand-over documents

These values were copied into the documents that carried the `G2` placeholders by the W5B merge (none is left). The installer SHA256 and size are not G2 values: they went back to the placeholders `{{W6: installer SHA256}}` and `{{W6: installer bytes}}`, which W6 fills from `SHA256SUMS` of the final build in the default folder, because a self-test build's hash would make the owner's check fail. Each value is read from `results.md` or `verdict.md` in this folder. A value that depends on a row that was not measured says so; do not replace those with a number.

| Placeholder | Value to write | Source in this folder |
| --- | --- | --- |
| installer SHA256 | not written: `{{W6: installer SHA256}}` stays until the final build. History only: the W5B self-test build in `D:/dev/release-c/0.1.0` gave `6dbf8f49709fca3d7f934e94e88f657de00dad426da49e7df61a39ef4bd2eca0` | `results.md` section 12 |
| installer bytes | not written: `{{W6: installer bytes}}` stays until the final build. History only: 3,253,179 bytes for the same self-test build | `results.md` section 3 |
| idle memory | 1,082 MB at HOME, median of 3 (smoke build, real data, desktop caps, 4 October 2026); over the 500 MB ceiling; about 920 MB once the working set is trimmed after five minutes; the browser terminal in the same session reads 918 MB; T4 fires | `results.md` sections 3 and 8 |
| soak memory | largest sample 1,577.4 MB (the first sample, the start-up peak; 1,509.8 MB by a second sampler), 1,292 MB at most after 15 minutes, 749 MB at most after 45 minutes; 3 hours, PARTIAL | `results.md` section 7 |
| summary of the automated rows and the date | "4 October 2026 (night of 3 to 4): not yet passed. Within ceiling: backend ready, splash, usual-launch cold HOME, warm HOME, EQ and REG warm, grid, GIP pan and zoom, keystroke, installer, the eight routes, and the 20,000-point hop. Over ceiling: first-launch cold HOME (5,048 ms against 5,000 ms), idle memory and the soak's start-up peak. The drift run passed 14 of 14 on its second run. Not tested: the simulated minimise (no engine-level driver yet). Open: the measure-artefact rows. Owner-attended rows pending." | `verdict.md` |
| results document | `docs/desktop/g2_windows/results.md` (verdict in `verdict.md`) | |
| measure cold HOME median | pending: the measure artefact's real-lab rows were not run (port 8765 listening). For reference only, on the GNU smoke build: first launch 5,048 ms, usual launch 3,321 ms | `results.md` sections 3 and 6 |
| first launch | 5,048 ms in the app (smoke build, quiet series; 5,583 ms in the first series), against the 5,000 ms G2 ceiling and the 6,000 ms first-launch cap; 4,260 ms (4,639 ms in the first record) in the stage 1 reading without the shell | `results.md` sections 3 and 4 |
| usual launch | 3,321 ms in the app (median of 3, state filled); 3,235 ms (3,413 ms) in the stage 1 reading | `results.md` sections 3 and 4 |
| volmanaged_v0 EQ warm | 628 ms, the Enter unit, real data, desktop caps (512 MiB bars, 128 MiB files), median of 5; target 1,000 ms, ceiling 1,500 ms; the harness's second run of the same line reads 39 ms | `results.md` section 4 |
| overnight soak length | 3 hours (176 to 180 minutes, 36 and 37 samples), PARTIAL | `results.md` section 7 |
| all-day soak largest sample | not run: an owner check on a day the PC can be left alone | `verdict.md` |
| pending measure-artefact real-lab rows | backend ready, splash, cold HOME and idle memory on the measure artefact (3 runs each), and the smoke against measure agreement test; skipped because port 8765 was listening (decision 11). The measure build is installed and checked at `D:\dev\d5\measure\app`; before the repeat, `jobs.json` sha256 was `44CAE38ADB6F6E142C013AC988929B5E12F20363CB82C990A40E77C34B2172D4` and `backtests/output` held 229 entries | `results.md` section 6 |
| provisional rows and their CPU load | none by the CPU gate (every counted run at 9.8% or lower, 3.4 to 9.8% across the series). Labelled all the same: no owner-named quiet window; every harness figure UNREPRODUCED (HOME ready +13.8% against W0B); the soak partial | `verdict.md` |

Items for the merge that are not placeholders are in the final message of the wave and repeated in `results.md` section 9.
