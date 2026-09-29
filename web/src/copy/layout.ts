// Copy for the workspace's layout safety (UI_SPEC section 2, roadmap #6): what typing a mnemonic, or
// Shift+GO, will do to the panels before it runs, and the reset and undo actions that recover a
// layout instead of losing it. UK spelling, no em or en dashes. `{name}` slots are filled by
// fillCopy() (copy/workspace.ts).

/** Joins two preview clauses. Its own export so the shell's <GO> preview row (chrome/CommandLine.preview.tsx)
 *  imports only this string, not the whole LAYOUT object (about 350 B gzip of shell budget). */
export const LAYOUT_SEPARATOR = ' | '

export const LAYOUT = {
  replace: '<GO> replaces {panel} with {code}',
  add: '<Shift+GO> adds {code} in a new panel right of {panel}',
  addAlone: '<Shift+GO> opens {code} in a new panel',
  loadSaved: '<GO> restores your saved {screen} ({n} panels)',
  loadDefault: '<GO> loads the {screen} layout ({n} panels)',
  loadContext: '<GO> loads {screen} for this context ({n} panels)',
  retarget: 'retargets [{group}]: {panels}',
  separator: LAYOUT_SEPARATOR,
  editedMark: '*',
  editedLabel: 'edited',
  reset: '{screen} is back to its default layout. UNDO restores yours.',
  resetDefault: '{screen} already shows its default layout.',
  undone: 'Undone: {screen} is back as it was.',
  undoNone: 'Nothing to undo: the last 10 layout changes are kept until the page reloads.',
  dropped: 'Your saved {screen} was made from an older default, so the default is shown. UNDO restores yours.',
  undoOption: 'Undo layout change',
  resetOption: 'Reset this layout',
} as const
