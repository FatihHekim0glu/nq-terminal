// Copy for the terminal frame (UI_SPEC section 2). UK spelling, no em or en dashes.

export const FRAME = {
  appTitle: 'nq-lab terminal',
  prompt: 'nq-lab>',
  commandLabel: 'Command line',
  commandPlaceholder: 'type a mnemonic, for example REG or HELP',
  commandHint: 'Commands are wired up in the next build stage.',

  contextLabel: 'Link groups',
  contextEmpty: '-',

  safetyLabel: 'Safety',
  readOnly: 'READ ONLY',
  noOrderPath: 'NO ORDER PATH',

  workspaceLabel: 'Workspace',
  workspaceTitle: 'WORKSPACE',
  workspaceMnemonic: 'HOME',
  workspaceEmpty: 'No panels open yet.',
  workspaceNote:
    'Screens load here once the API client is in place. This page fetches nothing and reads no file.',

  statusLabel: 'Status bar',
  screen: 'SCR 00 HOME',
  dataWindow: 'DATA 2010-01-01..2021-12-31',
  tws: 'TWS: not monitored',
  kill: 'KILL: not read',
  clockZone: 'ET',
} as const

export const LINK_GROUPS = ['A', 'B', 'C'] as const
