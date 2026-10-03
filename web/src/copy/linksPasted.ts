// Copy for a link pasted into the command line. Read by chrome/deepLink.paste.ts only, which loads on demand, so
// it stays out of the first-paint shell (LINKS in copy/links.ts is in it). UK spelling, no em or en dashes.

export const LINKS_PASTED = {
  /**
   * The refusal for a pasted link that is malformed: too long, too many lines, or text outside the command
   * alphabet. The link is not in the address bar here, so it says what a link may hold, so the text can be fixed.
   * Keep the line count equal to MAX_LINK_LINES (chrome/deepLink.ts).
   */
  refused:
    'That link holds no command the terminal can run. A link may hold at most 8 lines of letters, digits, spaces, full stops, hyphens and underscores.',
} as const
