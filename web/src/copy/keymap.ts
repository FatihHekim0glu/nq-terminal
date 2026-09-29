// Copy for the key map overlay (spec 5.2, Alt+K). The overlay loads as a chunk of its own the first time it is opened
// (App.tsx), so its words are not in copy/chrome.ts, which is part of the first-paint shell (shell diet 3, roadmap
// wave 9; scripts/shellBudget.test.ts). UK spelling, no em or en dashes.

export const KEYMAP = {
  title: 'Keyboard map',
  close: 'Close the key map',
  closeText: 'Close',
} as const
