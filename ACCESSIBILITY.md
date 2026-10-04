# Accessibility

nq-lab terminal is a dense, keyboard-first research terminal. This page says what accessibility standard it aims at,
what has been built and how each part is tested, which environments it is meant for, what is not finished, and how to
tell the maintainer about a barrier.

## Commitment

The target is [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA, in the browser terminal and in the Windows desktop
app, which shows the same page. The desktop app is held to the same standard through WCAG2ICT, with a framed window
(a screen reader is silent in a frameless one) and the engine's own browser keys turned off so that the terminal's
keys reach the page.

This is a commitment to a standard, not a claim of conformance. Automated tests cannot prove conformance, and the
checks that need a person with a screen reader are still to be done (see [Known limitations](#known-limitations)).
The design notes are in [`docs/UI_SPEC.md`](docs/UI_SPEC.md), section 9, with the colour evidence in
[`docs/BLOOMBERG_LOOK.md`](docs/BLOOMBERG_LOOK.md).

## What is built

- **Keyboard first.** Every action can be done from the keyboard (WCAG 2.1.1). There are no always-on single-key
  shortcuts (2.1.4). The command line takes a function code and Enter; `Alt+1` to `Alt+9` focus a panel, `Alt+K` shows
  the keyboard map, `Ctrl+K` focuses the command line, `F1` opens help, and `Esc` backs out one level. A key toolbar
  under the frame strip shows the main keys as buttons. Every numbered row can also be reached with Number `<GO>` in
  the command box, which is the equivalent control for a row that is smaller than a pointer target.
- **Visible focus.** A 2px white focus ring on every control, inset on grid cells, at least 3:1 against its
  background (2.4.7, 2.4.11). A focused cell scrolls into view and a sticky header does not cover it.
- **Colour and contrast.** Every text colour is at least 4.5:1 and every graphic pair at least 3:1 (1.4.3, 1.4.11),
  checked for the default look, for the optional amber classic look, and for two colour-vision schemes
  (deuteranopia and protanomaly) chosen in the Options menu. A sign is never shown by colour alone: every signed value
  carries a sign or a glyph (1.4.1).
- **Charts have a text form.** Every canvas chart has `role="img"`, an `aria-label` with a data summary (range, last
  value, maximum drawdown) and a table view. Press `T` with a chart focused to swap the picture for the table. Left
  and Right step the crosshair one bar and update a readout under the chart.
- **Pivot grids have a table form.** The pivot views (LEDG pivot, a run's trades and fills, the OOS log) have a
  visible Show as Table or Pivot grid toggle over the same rows. Table is the default under reduced motion, and it
  takes over, with an alert, if the pivot grid cannot start.
- **Motion.** `prefers-reduced-motion` is honoured. Nothing animates numbers and every state change is a hard cut. The
  only motion is the command-line caret, which holds steady under reduced motion.
- **Target size.** Controls are at least 24 px, or meet the spacing exception (2.5.8). Panels cannot be resized by
  dragging, because a drag has no single-pointer equivalent (2.5.7).
- **Live changes are announced.** Errors and notices go to a polite status line, so they are read without moving the
  focus.
- **Zoom and reflow.** At 200% zoom, in a 1,366 by 768 window and in a 1,024 by 640 window, every maximised panel
  keeps every control reachable: through an overflow menu, a scrolling body, or both, and never by clipping a control
  away (1.4.4, 1.4.10). At 700 CSS pixels and narrower the panels stack in reading order and only the page scrolls
  vertically. The wide data grids scroll sideways inside their own box, which is the data-table exception of 1.4.10.
  The desktop app's zoom runs from 50% to 300% in 25% steps (`Ctrl+plus`, `Ctrl+minus`, `Ctrl+0`) and its smallest
  window is 1,024 by 640.
- **Text spacing.** Chrome and panel text is not clipped under the text-spacing overrides of 1.4.12.

## How it is tested

| What | Where | What it covers |
| --- | --- | --- |
| axe, with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` | Playwright specs under `web/e2e` (`shell.spec.ts`, `home.spec.ts`, `panels.spec.ts`, `keys.spec.ts`, `perspective.spec.ts`, `visual/screens.spec.ts`, the `flows` folder and others), through `@axe-core/playwright` | HOME, every screen, the command dropdown and the menus, in both looks and at 1,920 by 1,080 and 1,366 by 768. A scan must come back clean |
| Colour contrast | `web/src/theme/contrast.test.ts`, with `tokens.test.ts`, `cvdSim.test.ts` and, for the amber classic look, `amberClassic.looks.test.ts` | Every text pair at 4.5:1 and every graphic pair at 3:1, in the default look, the amber classic look and both colour-vision schemes, with the negative cases that must fail |
| Keyboard flows | `web/e2e/keys.spec.ts`, `fkeys.spec.ts`, `flows/keyboard.spec.ts` and `web/e2e/desktop/40-keys.desktop.ts` | The key grammar, focus order, focus return after a menu closes, and the chart keys |
| Zoom and reflow at 200% | `web/e2e/reflow-200.spec.ts`, `reflow-menus-200.spec.ts` and `web/e2e/desktop/50-zoom.desktop.ts` | Every panel maximised, in the 1,366 by 768, 1,024 by 640 and 1,920 by 1,080 windows at 200%: every control present and reachable, nothing overlapping, nothing cut off, nothing but a data grid scrolling sideways. The detectors are tested born failing with planted faults. `shell.spec.ts` also checks 400% zoom and 320 CSS pixels |
| The desktop shell | The desktop Playwright project (`pnpm e2e:desktop`) against a hidden build of the app, with the engine's own zoom | The same page inside WebView2, with the window watch over every window |

Figures from the project record, with their sources:

- In the desktop Playwright project, 41 specs passed against the rebuilt build in the release check of
  3 October 2026 ([`docs/desktop/d5_integration.md`](docs/desktop/d5_integration.md)).
- The 200% reflow survey of 44 panels in three windows passes 133 of 133 cases. It failed 75 of 89 before the fixes
  ([`docs/desktop/owner_decisions_windows.md`](docs/desktop/owner_decisions_windows.md), entry 1.2).

Run the suites from the `web` folder with `corepack pnpm e2e` (the browser terminal, in Chromium) or
`corepack pnpm e2e:desktop` (the app). See [`docs/TESTING.md`](docs/TESTING.md) for the rest.

## Supported environments

| Environment | Status |
| --- | --- |
| Windows desktop app: Windows 11, with the Microsoft Edge WebView2 Runtime (Evergreen) | Built for and tested on Windows 11. The installer embeds the WebView2 bootstrapper, so a missing runtime is repaired during the install. Windows 10 is not a stated target and has not been tested |
| Browser terminal in a current Chromium browser (Chrome or Edge) | Tested. The Playwright suites, including the axe scans, run in Chromium |
| Browser terminal in a current Firefox or Safari | The build uses features those browsers have, but no suite runs in them, so it is not tested and not promised |
| Screen readers | NVDA and Narrator on Windows are the intended pair. See below: neither pass has been done yet |
| Touch and small phones | Not a target. The terminal is built for a keyboard. The layout reflows at narrow widths (checked at 320 CSS pixels), but touch use is not tested |

## Known limitations

These are stated plainly. Some are rows of the owner-attended checks, which a person has to do and which are still
pending. Their templates and status are in [`docs/desktop/checks/`](docs/desktop/checks/README.md).

- **No screen-reader pass has been done yet.** The NVDA check and the Narrator check
  ([`2026-10-03_nvda.md`](docs/desktop/checks/2026-10-03_nvda.md),
  [`2026-10-03_narrator.md`](docs/desktop/checks/2026-10-03_narrator.md)) are written and both read NOT RUN. Axe and
  the other tests cannot hear anything, so how HOME, a grid, a chart's table view and the command line sound is
  unknown until a person listens.
- **The real keyboard check is pending.** The automated tests send keys over the debugging protocol, which skips the
  window's own key handling. Whether each of the 16 keys of the check (F1, F8, F9, F10, F11, `Alt+1` to `Alt+9`,
  `Alt+K`, `Ctrl+K`) reaches the page when pressed on a real keyboard, and whether F10 goes to the system menu, is
  recorded in [`2026-10-03_real-keyboard.md`](docs/desktop/checks/2026-10-03_real-keyboard.md), not yet run.
- **The 200% zoom check by eye is pending.** The automated survey passes, but it shows that a control exists and can
  be focused, not that a person can find it. The look by eye on the installed release is
  [`2026-10-03_zoom-200-by-eye.md`](docs/desktop/checks/2026-10-03_zoom-200-by-eye.md), not yet run.
- **No forced-colours or increased-contrast styles.** There is no `forced-colors` or `prefers-contrast` rule in
  `web/src`, so Windows contrast themes and macOS Increase contrast do not change the terminal, and the canvas charts
  do not switch to system colours. The table view gives a text alternative for every chart. The gap is listed as a
  later phase in [`docs/desktop/owner_decisions_windows.md`](docs/desktop/owner_decisions_windows.md), section 5.
- **The Perspective pivot grid is not checked by axe or a screen reader.** It draws its grid in a shadow tree that axe
  leaves out. The Table view of the same rows is the accessible form, and it is the default under reduced motion.
- **Density.** The terminal is dense on purpose. Wide data grids scroll sideways inside their panel at 200% zoom, which
  WCAG allows for data tables, but that is still work to read with a magnifier.
- **One dark base.** The terminal has a dark base, an optional amber classic look and two colour-vision schemes. There
  is no light theme.
- **No automatic test with real assistive technology.** Everything listed under How it is tested runs in a browser
  engine, not in a screen reader or a magnifier.
- **One test machine.** The app and the browser terminal have been tested on one PC. Other displays, scales and
  keyboard layouts may show faults this project has not seen.

## Report a barrier

If something in the terminal stops you using it, tell the maintainer. A barrier is a bug and is treated as one.

- **Public report.** Open an issue on [GitHub](https://github.com/FatihHekim0glu/nq-terminal/issues) and give it the
  `accessibility` label, or put "Accessibility" at the start of the title if you cannot set labels. Say what you were
  trying to do, which screen or mnemonic, what happened, and what you use (the screen reader and its version, the
  browser or the desktop app, the Windows version, the zoom, the window size).
- **Private report.** If you would rather not post details in public, open an issue that says only that you have an
  accessibility report to make privately, with no details in it. The maintainer
  ([@FatihHekim0glu](https://github.com/FatihHekim0glu)) will answer on GitHub and arrange how to take the details.
  Do not use the security route for this: it is for vulnerabilities only (see [SECURITY.md](SECURITY.md)).

No email address is published. This is a personal tool looked after by one person, so replies and fixes are best
effort. A barrier that stops a task outright is looked at before a cosmetic one.

Contributions that fix a barrier are welcome. They are reviewed by the one maintainer, and a change to the interface
comes with a test, as in [`docs/TESTING.md`](docs/TESTING.md).

## Licence

See [LICENSE](LICENSE).
