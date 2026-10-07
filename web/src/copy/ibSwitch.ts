// Copy for the IB snapshot switch in Options (desktop app only). It has a module of its own so that the chunk that draws
// the switch does not carry the LIVE panel's copy (chrome/IbSwitch.tsx, scripts/shellBudget.test.ts). UK spelling, no em
// or en dashes.

// The switch in Options (desktop app only): it asks the app, which confirms in its own dialog, and the change applies
// when the terminal next starts. The state words say what is in force in this session.
export const IB_SWITCH = {
  label: 'IB snapshot (read only)',
  noteOn: 'On in this session. Changing it asks you to confirm and takes effect when the terminal next starts. There is no order path either way.',
  noteOff: 'Off in this session. Changing it asks you to confirm and takes effect when the terminal next starts. There is no order path either way.',
  asked: "Answer the app's dialog to confirm.",
  // Shown once the window has the focus back, whatever the answer was: the page is not told which button was pressed.
  answered: 'If you confirmed, the change applies when the terminal next starts. This switch shows the setting in force now.',
} as const
