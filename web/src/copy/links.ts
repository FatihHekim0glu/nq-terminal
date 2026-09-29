// Copy for terminal links that the first-paint shell reads: what the terminal says when the address bar
// carries a link it will not run. The Copy link rows live in LINK_COPY (copy/linkCopy.ts), which loads
// with the Workspace only. UK spelling, no em or en dashes. `{name}` slots are filled by fillCopy()
// (copy/workspace.ts).

export const LINKS = {
  /** The address bar holds a #go= link that is malformed: too long, too many lines, or text outside the command alphabet. */
  refused: 'The link in the address bar holds no command the terminal can run.',
  /**
   * A well formed link with a line that parsed to something other than a screen, a context or help
   * (RESET, UNDO, GRAB, a number, and so on). A line that does not parse says why in the command line's
   * own words instead (describeError), so this never names a line that is merely mistyped.
   */
  refusedLine: '{line} cannot run from a link: links open screens, contexts and help only.',
} as const
