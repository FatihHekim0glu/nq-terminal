// What the message line says when the terminal's workspace store cannot take the page's changes (03 section 10.4, WCAG
// 4.1.3). Kept apart from copy/chrome.ts so the first-paint shell does not carry it: only state/remoteStore.ts reads it.
// UK spelling, no em or en dashes.

export const STORE_NOTICE = {
  /** The store did not answer or will not take this session: the change waits and is sent again. */
  unsaved: "Your changes are kept in this browser but could not be saved to the terminal's store. They will be sent again.",
  /** The store refused a change: it is not sent again. */
  refused: "The terminal's store did not accept a change. It is kept in this browser only.",
  /** The store answers again and what was waiting is saved. */
  restored: "The terminal's store is back. Your changes are saved.",
} as const
