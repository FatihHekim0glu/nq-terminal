// The panel waiting and retry lines: what a panel shows while the backend is down (the waiting lines)
// and the button on a failed request (the retry lines). Read only by PanelFault and GpStatus, and kept
// out of copy/connection.ts so the shell chunk, which holds that file, does not carry them. UK
// spelling, no em or en dashes. `{name}` slots are filled by fillCopy() (copy/workspace.ts).

export const CONNECTION_PANEL = {
  waiting: 'Waiting for the backend: {request} answered {answer}.',
  waitingLoad: 'Waiting for the backend before loading.',
  retry: 'Retry',
  retryLabel: 'Retry this request',
} as const
