// Copy for the command line's numbered menus and suggestion sheet, read only by the code that loads on demand (chrome/CommandLine.menus.ts,
// CommandLine.menu.tsx, CommandLine.sheet.tsx): kept apart from copy/commands.ts so the first-paint shell does not carry it.
// UK spelling, no em or en dashes. `{value}` is filled in by src/commands/messages.ts.

/** Autocomplete group headings: uppercase, as the data itself is a heading (spec 3.3). */
export const SUGGESTION_GROUPS = {
  function: 'FUNCTIONS',
  instrument: 'INSTRUMENTS',
  hypothesis: 'HYPOTHESES',
  run: 'RUNS',
  universe: 'UNIVERSE',
  argument: 'ARGUMENTS',
  search: 'SEARCH',
} as const

/** The "More ..." row under a group that has more rows than the sheet shows. */
export const SUGGESTION_MORE = {
  function: 'More functions...',
  instrument: 'More instruments...',
  hypothesis: 'More hypotheses...',
  run: 'More runs...',
  universe: 'More...',
  argument: 'More...',
  search: 'More...',
} as const

/** The menu and sheet lines of the command line (the shell's own lines are COMMAND_LINE in copy/commands.ts). */
export const COMMAND_MENUS = {
  suggestionsLabel: 'Suggestions',
  hideHint: '<UP ARROW> to hide',
  lastTitle: 'Last commands',
  lastEmpty: 'No commands yet.',
  menuTitle: 'Related functions',
  searchTitle: 'Search: {value}',
  searchNone: 'Nothing matches {value}.',
  helpTitle: '{value}',
  helpContext: 'Context: {value}',
  helpArgument: 'Argument: {value}',
  menuCancel: '<Cancel> X',
  menuCancelLabel: 'Close the menu',
  menuLabel: 'Menu',
  categoryMark: ' >',
} as const

/** Sector menus (spec 5.1 item 4): COMDTY opens these categories. */
export const SECTOR_MENU = {
  INDEX: 'Index',
  COMDTY: 'Comdty',
  CURNCY: 'Curncy',
  EQUITY: 'Equity',
  GOVT: 'Govt',
  CORP: 'Corp',
  categories: {
    rates: 'Rates',
    energy: 'Energy',
    metals: 'Metals',
    grains: 'Grains',
    livestock: 'Livestock',
  },
  none: 'No futures in nq-lab carry this sector key.',
} as const
