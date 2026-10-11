# w0-owner-pack, slice checks-refresh

Status: the owner templates are refreshed for 0.3.3 and later releases. The tests that this slice owns pass. Two items are not done, the owner-session wiring and the vitest run; both are listed below.

## What changed

- The 13 templates dated 3 October 2026 no longer name the 0.1.0 installer, its size, its SHA-256 or its release commit. The release commit cell now carries the phrase `installed tag and release commit (desktop/scripts/owner-session.ps1 fills this)`. The installer file name, size, SHA-256 and release folder are `{{...}}` fill-ins. Every pass rule is unchanged.
- Four templates dated 11 October 2026, owner instructions only: `2026-10-11_ib-switch-paper-tws.md`, `2026-10-11_minimised-close.md`, `2026-10-11_ib-dialog-screen-reader.md`, `2026-10-11_real-contrast-theme.md`.
- `session_order.json`: 14 steps in the order keyboard, NVDA, Narrator, the IB dialog with a screen reader, then the rest. The minutes sum to 210 (about 3.5 hours of attention). The file uses the `check`, `template` and `owner_minutes` keys that `owner-session.ps1` reads.
- `README.md`: one table of the 18 templates in the session order, with the three non-session templates and the install test below it. The all-day soak note about wave e2-endurance-040 is in the README.
- `desktop/harness/tests/docs-claims.test.mjs`: two cases added (see the tests below).

## Source corrections

- The spec gives `handover_windows.md:334` for the IB switch. Line 334 is the install test. The IB switch text is at lines 138 to 139 (items 7 and 8), and the minimised start is item 8. The template cites the right lines.
- `g2_windows/verdict.md:100` is in the 0.3.0 section ("Not re-measured on 0.3.0"), which the contrast template cites.

## Tests

- `node --test desktop/harness/tests/docs-claims.test.mjs`: 4 of 4 pass (2 existing, 2 new).
- Born-failing evidence, run before the fix (output saved in `D:/dev/v04/w0-owner-pack/born-failing-1.txt`):
  - "no owner check template names a release commit, an installer hash or the 0.1.0 release" failed with 40 offending matches across the 13 templates and the README, the first being `2026-10-03_all-day-soak.md matches /8122c877/`. The weekly-parity line 17 is among them.
  - "every session step in session_order.json names an existing owner template" failed with `ENOENT` on `session_order.json`.
- Prose lint (`ai_pattern_check.py`) on the 18 owned files: 18 PASS, 0 WARN, after the README sentence triads were rewritten.
- Dash scan on every owned file and the test file: no em or en dash.
- `pnpm --dir web exec vitest run scripts/docsSync.test.ts`: not run (see not done).

## Appendix A addendum (fate of new files)

| File | Fate |
| --- | --- |
| `docs/desktop/checks/2026-10-11_ib-switch-paper-tws.md` | new owner template, kept (no code) |
| `docs/desktop/checks/2026-10-11_minimised-close.md` | new owner template, kept (no code) |
| `docs/desktop/checks/2026-10-11_ib-dialog-screen-reader.md` | new owner template, kept (no code) |
| `docs/desktop/checks/2026-10-11_real-contrast-theme.md` | new owner template, kept (no code) |
| `docs/desktop/checks/session_order.json` | new, read by `desktop/scripts/owner-session.ps1` and by the docs-claims test |

No module, route or code file is added by this slice.

## Stale lines in `docs/desktop/checks/2026-10-05_install-upgrade-test.md` (not edited here, for wave w9)

- Line 3: the status line says "RUN ... before the 0.1.2 release build", and the result box is ticked PASS for that build.
- Line 7: "since 0.1.1 was installed", a fact about the owner's install at that time.
- Lines 18 to 26: the example commands name `desktop-v0.1.1`, the 0.1.2 build with `-BuildVersion 0.1.2`, and the installer paths `0.1.2-59c83cec2c` and `0.1.1-777c162915`.
- Lines 37 and 39: the scenario table speaks of 0.1.1 over 0.1.2.
- Lines 49 and 50: the renamed installer rows for `desktop-v0.1.1` (commit `777c1629...`) and for HEAD `59c83cec...`.
- Lines 59 to 69: the records for the tags 0.1.2, 0.2.0, 0.2.1, 0.3.0, 0.3.1 and 0.3.2. There is no record for 0.3.3.
- Line 77: "the owner's own upgrade from 0.1.1".

## Wiring for the merge step (files this slice does not own)

1. `desktop/scripts/owner-session.ps1`, which another slice owns. Its `Set-RecordFields` fills the `Installer SHA-256` cell only when the cell holds a 64-character hash, so the `{{installer SHA-256 from SHA256SUMS of the installed tag (desktop/scripts/owner-session.ps1 fills this)}}` cell in each template is not filled. The script must also fill the `{{...}}` fields for the installer file name, the installer size in bytes, the release folder (`D:\dev\release\<version>`, used in the commands) and, in `2026-10-11_minimised-close.md`, the path of the installed executable. Until that change lands, the owner fills those cells by hand from `SHA256SUMS`.
2. `docs/desktop/checks/2026-10-05_install-upgrade-test.md` stays with the finisher or w9, as the stale lines above say.

## Not done

- `pnpm --dir web exec vitest run scripts/docsSync.test.ts` was not run. The file reads `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/media` and `contract/openapi.json`, none of them owned by this slice, so the owned edits do not touch its inputs. The run was blocked: a pnpm call in the shared web toolchain changed the main tree's `web/node_modules` (see the final message of this slice).
- The owner-session fill was not exercised end to end: `owner-session.ps1` belongs to another slice.
- No `windows.jsonl` record: no real backend was started.
- The templates were not opened in a browser or a screen reader; they are plain Markdown.
