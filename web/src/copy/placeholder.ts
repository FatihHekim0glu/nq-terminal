// Copy for the placeholder panel a screen that is not built yet shows (chrome/WorkspacePlaceholder.tsx). Only that
// on-demand chunk reads it, so it is not in copy/workspace.ts, which is part of the first-paint shell (shell diet 3,
// roadmap wave 9; src/copy/panelParts.split.test.ts). UK spelling, no em or en dashes. `{name}` slots are filled by
// fillCopy() (copy/workspace.ts).

export const PLACEHOLDER = {
  heading: '{code}: {screen}',
  status: 'Not built yet.',
  P0: 'This screen arrives in phase {phase} of the build. The command, the panel and its link group already work.',
  P1: 'A P1 screen, planned for after the P0 release.',
  P2: 'A P2 screen, built only after the user gives an explicit go.',
  context: 'Context: {value}',
  noContext: 'Context: none',
  argument: 'Argument: {value}',
  gridCaption: '{code} placeholder: what this panel will show',
  itemColumn: 'Item',
  valueColumn: 'Value',
  noteColumn: 'Note',
  rowScreen: 'Screen',
  rowStatus: 'Status',
  rowBuild: 'Build',
  rowContext: 'Context',
  rowArgument: 'Argument',
  missing: '--',
  none: 'none',
} as const
