// Copy for named workspaces (roadmap #14): SAVE NAME keeps the panels on screen as a recipe of command
// lines, LOAD NAME rebuilds them, FORGET NAME drops one. UK spelling, no em or en dashes. `{name}` slots
// are filled by fillCopy() (copy/workspace.ts).

export const WORKSPACES = {
  saved: 'Saved {name} ({n} panels).',
  savedOne: 'Saved {name} (1 panel).',
  /** The browser refused the write (site data blocked or storage full): the workspace lives in this window only. */
  savedSession: 'Saved {name} for this session only: this browser is not keeping site data.',
  loaded: 'Loaded {name}.',
  forgotten: 'Forgot {name}.',
  missing: 'No workspace named {name}. LOAD lists the saved ones.',
  full: 'At most 12 workspaces: FORGET one first.',
  /** A saved line that no longer parses (a hypothesis or run that left the registry) refuses the whole load. */
  lineFailed: '{name} could not load: its line {line} no longer runs ({reason}).',
  /** The reason when a saved line still parses but is not a screen command (RESET, LAST, a bare number). */
  notScreen: 'it is not a screen command',
  menuTitle: 'Workspaces',
  none: 'No workspaces yet: SAVE NAME keeps the panels on screen.',
  badName: 'That is not a workspace name.',
  /** The panels on screen could not be written as a recipe (no workspace yet, an unreadable panel, too large). */
  notKept: 'The panels on screen cannot be kept as a workspace right now.',
  /** A panel that takes a subject shows none, so its line would read as a bare mnemonic and LOAD could not run it. */
  noContext: '{name} was not saved: its line {line} shows no subject yet, so it could not load again.',
} as const
