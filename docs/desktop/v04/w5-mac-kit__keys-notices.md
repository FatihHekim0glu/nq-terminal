# w5-mac-kit, slice keys-notices

Wave w5-mac-kit, slice `keys-notices` (roadmap D7.4, web layer). This note records what was built, how to run it, the files added for the
03 Appendix A addendum, and what is not verified.

## What changed

### Keys table, `pc` or `mac`

`web/src/chrome/CommandLine.keys.ts` now has a `KeysTable` type (`'pc' | 'mac'`) and `detectKeysTable()`, which reads
`navigator.userAgentData.platform`, then `navigator.platform`, and answers `mac` only for a platform name that starts with "mac". Anything
else, or no navigator at all, is `pc`.

`globalKeyAction`, `isFocusKey`, `useCommandLineKeys` and `useTerminalKeys` take the table as a last, optional argument. The default is
`'pc'` for the two pure maps and the detected platform for the two hooks, so no caller had to change and the PC behaviour is as it was.

| Binding | pc | mac |
|---|---|---|
| Focus the command line and select it | Ctrl+K or Meta+K (as before) | Cmd+K only (Ctrl+K stays the text field's kill-to-end-of-line) |
| BACK | End | End (Fn+Right on a laptop) or Cmd+[ |
| FORWARD | Shift+End | Shift+End or Cmd+] |
| Focus panel N, key map | Alt+1 to Alt+9, Alt+K | the same keys, named Option in HELP (matched by physical key, as before) |
| F1, F8 to F11, F2 to F7 held back, PgUp, PgDn, Home, Esc | as before | as before; HELP names the Fn key a laptop needs |

Every map still returns nothing when the event is `defaultPrevented` or composing, on both tables, and the hooks leave a prevented event
alone. Vitest cases cover that for every mapped key on both tables.

### HELP shows the bindings of the running platform

`web/src/copy/help.ts` keeps `HELP_KEYS` and `HELP_KEYBOARD` as the PC table and adds `helpKeysFor(table)` and `helpKeyboardFor(table)`. The
Mac table is derived from the PC rows, so the two cannot drift apart: Ctrl+K becomes Cmd+K, Alt becomes Option, the keys a laptop lacks (Home, End, PgUp, PgDn)
gain their Fn spelling, every F-key row says to hold Fn, and two rows are added for Cmd+[ and Cmd+]. Tests fail if a Mac word (Cmd, Option,
Fn) appears in the PC rows or a PC word (Ctrl, Alt, Windows) in the Mac rows.

HELP also gets four strings for the notices link: `noticesHeading`, `noticesText`, `noticesLink` and `noticesUrl`
(`third-party-notices.txt`, relative). The screens that render them are not owned by this slice; see wiring below.

### Full third-party notices

`web/scripts/thirdPartyNotices.mjs` writes `web/public/third-party-notices.txt` from `web/pnpm-lock.yaml` and the licence files in each
installed package. It lists the production closure of the lockfile (the root importer's dependencies and everything their snapshots pull in);
dev dependencies are not shipped and are left out. Today that is 116 packages, plus the vendored Bergoom font as an extra entry.

`desktop/scripts/rust-notices.mjs` writes `desktop/src-tauri/THIRD_PARTY_NOTICES.txt` from `Cargo.lock`, with `cargo metadata --locked` for
each crate's folder and its declared licence and repository. Today that is 473 crates, plus the Microsoft WebView2 loader as an extra entry. The
generator skips the root crate `nq-lab-terminal` (and any crate with no `source`, which is a path crate of this repository), so the version
bump that rewrites that Cargo.lock entry never invalidates the notices.

Both files share one layout (the Rust script imports the renderer, the index parser and the licence-file reader from the web script):

- a `PACKAGES` index, one line per package: `- name version | licence | text ids | repository`;
- an `ALSO INCLUDED` section for what a lockfile does not list (`+ name | licence | text id`);
- `LICENCE TEXTS`, each distinct text once under `==== Tn ====`. An identical text used by hundreds of crates is printed once, so the
  Cargo file is 0.76 MB and the page file 0.17 MB.

A package whose files hold no licence text is still listed, with "no licence file in the package" in place of a text id (5 npm packages,
38 crates). The notices then carry its declared licence and repository only.

### The check

`node web/scripts/thirdPartyNotices.mjs --check` and `node desktop/scripts/rust-notices.mjs --check` compare the `PACKAGES` index with the
lockfile alone (no install, no cargo). Exit 0 matches, 1 names each missing and each stale entry, 2 means a file could not be read, so a
check that cannot run never passes. Both are also tests: `thirdPartyNotices.test.ts` and `rust-notices.test.mjs` run the check against the
real lockfiles, so any lockfile change without a regenerated notices file fails the suite.

## Commands

| What | Command |
|---|---|
| Regenerate the page notices | `node web/scripts/thirdPartyNotices.mjs` (needs the packages installed; reads the pnpm store under `web/node_modules`) |
| Regenerate the Cargo notices | `node desktop/scripts/rust-notices.mjs` (cargo on PATH, crates fetched; add `--offline` when they are) |
| Check both | the two commands above with `--check` |
| Tests | `node node_modules/vitest/vitest.mjs run scripts/thirdPartyNotices.test.ts src/chrome/CommandLine.keys.test.ts src/copy/help.examples.test.ts` from `web/`; `node --test desktop/scripts/tests/rust-notices.test.mjs` |

## Files, for the 03 Appendix A addendum

| File | Kind | Fate |
|---|---|---|
| `web/scripts/thirdPartyNotices.mjs` | new script and shared renderer | kept; the check is a test and a CLI |
| `web/scripts/thirdPartyNotices.test.ts` | new test | kept |
| `web/public/third-party-notices.txt` | new generated file, served by the page at `/third-party-notices.txt` | kept; regenerate on any `pnpm-lock.yaml` change |
| `desktop/scripts/rust-notices.mjs` | new script | kept |
| `desktop/scripts/tests/rust-notices.test.mjs` | new test | kept |
| `desktop/src-tauri/THIRD_PARTY_NOTICES.txt` | new generated file | kept; w6's merge regenerates it and ships it as an installer resource |
| `web/src/chrome/CommandLine.keys.ts` | changed (table, detection) | kept |
| `web/src/chrome/CommandLine.keys.test.ts` | changed (new describe block) | kept |
| `web/src/copy/help.ts` | changed (per-platform rows, notices strings) | kept |
| `web/src/copy/help.examples.test.ts` | changed (per-platform and notices cases) | kept |
| `docs/desktop/v04/w5-mac-kit__keys-notices.md` | this note | kept |

No route, endpoint or Rust module was added.

## Wiring for the merge step (files this slice does not own)

1. `web/package.json`, scripts: add `"notices": "node scripts/thirdPartyNotices.mjs"` and `"check:notices": "node scripts/thirdPartyNotices.mjs --check"`.
   The generator's failure text says `pnpm --dir web notices`.
2. The HELP screens, `web/src/chrome/HelpScreen.tsx`, `web/src/chrome/HelpScreen.keymap.tsx`, `web/src/screens/help/HelpScreen.tsx` and
   `web/src/screens/help/HelpIndex.tsx`: read the key rows with `helpKeysFor(detectKeysTable())` (and `helpKeyboardFor(...)` for the drawn
   keyboard) in place of `HELP_KEYS` and `HELP_KEYBOARD`, and after the licence list render `HELP.noticesHeading`, `HELP.noticesText` and a
   link `<a href={HELP.noticesUrl} target="_blank" rel="noopener noreferrer">` labelled `HELP.noticesLink` with the same "(opens in a new tab)"
   screen-reader text the TradingView link has. The existing HELP tests count rows with `HELP_KEYS.length`, which stays right on a PC.
3. CI and the desktop check: run `node web/scripts/thirdPartyNotices.mjs --check` and `node desktop/scripts/rust-notices.mjs --check` (for
   example in `desktop/scripts/check.ps1` and the web job of the CI workflow). Neither needs an install.
4. Wave w6: ship `desktop/src-tauri/THIRD_PARTY_NOTICES.txt` as an installer resource, and regenerate it after any crate change.

## Not verified, said plainly

- The Mac table is tested as pure maps and hooks under jsdom only. Nothing here has run on a Mac or in WKWebView: whether Cmd+[ and Cmd+]
  reach the page in Safari or WKWebView before the browser takes them, and what Fn+arrow sends in WebKit, are Tier C questions for the owner's Mac.
- The WebView2 loader licence text is the BSD-3-Clause text Microsoft publishes with the Microsoft.Web.WebView2 package, written from the
  published text; it was not compared against the package's own `LICENSE.txt` (no copy of the package is on this machine).
- 38 crates and 5 npm packages publish no licence file in their package. They are listed with the declared licence and repository, which
  does not carry a copyright line. The MPL-2.0 crate `selectors` is one of them; its licence is the standard text, published at its repository.
- The Cargo notices list every crate in `Cargo.lock`, including ones only another platform builds (the macOS and Android crates). Cargo.lock
  does not say which ship, and listing a crate that is not shipped is the safe error.
- Regenerating the page notices needs `web/node_modules` installed. Here it is read through the junction the manager set up to the main tree's pnpm store.
