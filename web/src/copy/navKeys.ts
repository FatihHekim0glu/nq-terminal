// The key toolbar's own messages: the line after BACK or FORWARD, and the F-keys held back from the browser.
// Read by chrome/KeyToolbar.actions.ts, which loads on demand (shell diet 4), so they sit here and not in copy/chrome.ts
// (a shell module) or copy/help.ts (HELP and the key map read that one, and both load later). UK spelling, no em
// or en dashes. `{name}` slots are filled by withValue() and fillCopy().

/** The message line after BACK (End) or FORWARD (Shift+End) moves the focused panel (U10). */
export const NAV_MESSAGES = {
  backTo: 'Back to {value}.',
  forwardTo: 'Forward to {value}.',
} as const

/**
 * F2 and F4 have no function of their own (look spec 5.2), and F3 and F5 to F7 are held back from the browser with
 * them (U11), so none of the sector keys near them (F8 to F11) can ever reload the terminal, leave it or cover the
 * command line. Only KeyToolbar.actions.ts reads them, so all six load with it and none with the shell (W5C).
 */
export const RESERVED_F_MESSAGES = {
  F2: 'F2 has no function in nq-lab. Type REG <GO> for the registry, or use a key on the key toolbar.',
  F3: 'F3 has no function in nq-lab: the browser find bar would cover the command line. Use SEARCH on the key toolbar (HL) instead.',
  F4: 'F4 has no function in nq-lab. Type LEDG <GO> for the ledger, or use a key on the key toolbar.',
  F5: 'F5 would reload: every panel history would be lost. Type HOME <GO> instead.',
  F6: 'F6 has no function in nq-lab: the browser address bar would take focus from the command line.',
  F7: 'F7 has no function in nq-lab: caret browsing is not used here.',
} as const
