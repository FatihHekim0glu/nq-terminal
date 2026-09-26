// Copy for the context strip and the status bar (UI_SPEC sections 2 and 8). UK spelling, no em or
// en dashes. `{value}` is filled in by the component.

export const CONTEXT_STRIP = {
  label: 'Link groups',
  empty: '-',
  focused: 'focused group',
} as const

export const STATUS_BAR = {
  label: 'Status bar',
  screenPrefix: 'SCR',
  dataWindow: 'DATA {value}',
  // The in-sample window as the gate enforces it, shown until /api/health answers.
  dataFallback: 'DATA 2010-01-01..2021-12-31',
  dataFallbackValue: '2010-01-01..2021-12-31',
  tws: 'TWS: not monitored',
  killOff: 'KILL: off',
  killOn: 'KILL: ON',
  killOnNote: 'The live/KILL file is present: the paper book will not trade.',
  killLoading: 'KILL: reading',
  killUnknown: 'KILL: unknown',
  healthDown: 'HEALTH: unavailable',
  healthDownNote: 'GET /api/health did not answer, so the kill switch state is unknown.',
  gateReads: 'gate reads {value}',
  fixture: 'FIXTURE DATA',
  readOnly: 'READ ONLY',
  noOrderPath: 'NO ORDER PATH',
  clock: '{value} ET',
  escHint: 'Esc cmd',
  empty: '-',
} as const
