// Copy for the event tape (spec 4.9). The tape is off by default and loads as a chunk of its own when switched on
// (App.tsx), so its words are not in copy/chrome.ts, which is part of the first-paint shell (shell diet 3, roadmap
// wave 9; scripts/shellBudget.test.ts). UK spelling, no em or en dashes.

export const TAPE = {
  label: 'Event tape',
  src: 'OOS',
  read: 'gate read',
  sealed: '[SEALED]',
  inSample: '[IS]',
  empty: 'No gate reads logged yet.',
  error: 'The gate log did not answer.',
  loading: 'Reading the gate log.',
} as const
