// Copy for the backend connection strip (roadmap #7). ConnectionStrip reads the strip lines (mounted in
// App since W4); noAnswer is also read by PanelFault, for a request the backend never answered. The
// panel waiting and retry lines live in their own copy module, out of the shell. UK spelling, no em or
// en dashes. `{name}` slots are filled by fillCopy() (copy/workspace.ts).

export const CONNECTION = {
  lead: 'API DOWN',
  down: 'The backend has not answered since {since} ET (GET /api/health: {answer}). Start it with start.ps1, or run pnpm demo for fixture data.',
  next: 'Next check in {seconds} s.',
  checkNow: 'Check now',
  checkNowLabel: 'Check now whether the backend answers',
  back: 'Backend back at {time} ET; {n} requests retried.',
  noAnswer: 'no answer',
} as const
