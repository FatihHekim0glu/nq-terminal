// Copy for the backend connection banner (roadmap #7). Nothing reads this yet: the banner itself is
// wave 4 (W4-INT); the keys are written now so the state machine and copy stay in step. UK spelling,
// no em or en dashes. `{name}` slots are filled by fillCopy() (copy/workspace.ts).

export const CONNECTION = {
  lead: 'API DOWN',
  down: 'The backend has not answered since {since} ET (GET /api/health: {answer}). Start it with start.ps1, or run pnpm demo for fixture data.',
  next: 'Next check in {seconds} s.',
  checkNow: 'Check now',
  checkNowLabel: 'Check the backend now',
  back: 'Backend back at {time} ET; {n} requests retried.',
  waiting: 'Waiting for the backend: {request} answered {answer}.',
  waitingLoad: 'Waiting for the backend before loading.',
  noAnswer: 'no answer',
  retry: 'Retry',
  retryLabel: 'Retry this request',
} as const
