// The key toolbar's own messages: the line after BACK or FORWARD, and the F-keys held back from the browser.
// Read by chrome/KeyToolbar.actions.ts, which is part of the first-paint shell, so they sit here and not in
// copy/help.ts (HELP and the key map read that one, and both load later). UK spelling, no em or en dashes.
// `{name}` slots are filled by withValue() and fillCopy().

/** The message line after BACK (End) or FORWARD (Shift+End) moves the focused panel (U10). */
export const NAV_MESSAGES = {
  backTo: 'Back to {value}.',
  forwardTo: 'Forward to {value}.',
} as const

/**
 * F3 and F5 to F7 join F2 and F4 as held back from the browser (U11), so none of the sector keys
 * near them (F8 to F11) can ever reload the terminal, leave it or cover the command line. Paired
 * with MESSAGES.reservedKeys (F2, F4) in copy/chrome.ts by KeyToolbar.actions.ts.
 */
export const RESERVED_F_MESSAGES = {
  F3: 'F3 has no function in nq-lab: the browser find bar would cover the command line. Use SEARCH on the key toolbar (HL) instead.',
  F5: 'F5 would reload: every panel history would be lost. Type HOME <GO> instead.',
  F6: 'F6 has no function in nq-lab: the browser address bar would take focus from the command line.',
  F7: 'F7 has no function in nq-lab: caret browsing is not used here.',
} as const
