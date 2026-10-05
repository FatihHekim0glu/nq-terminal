// Copy for the global job indicator, the finish notice and the anchor re-run badge (release 0.2.0). UK spelling, no
// em or en dashes. `{name}` slots are filled by fillCopy(). The words stay clear of the action-name scan: a job is
// queued, run and stopped, never submitted or cancelled.

export const JOBS_BAR = {
  label: 'Backtest jobs',
  running: 'RUNNING',
  queued: 'QUEUED',
  runLine: '{run} ({strategy})',
  elapsed: 'elapsed {span}',
  waiting: 'waiting {span}',
  typical: 'typical {span}',
  typicalNone: 'no typical time yet',
  more: '{n} more in the queue',
  openJobs: 'Open JOBS',
  openJobsLabel: 'Open JOBS, the whole queue',

  notice: {
    ok: 'Finished: {run} ({strategy}), OK in {span}.',
    okNoSpan: 'Finished: {run} ({strategy}), OK.',
    failed: 'Finished with failed checks: {run} ({strategy}) in {span}. The result is still written.',
    failedNoSpan: 'Finished with failed checks: {run} ({strategy}). The result is still written.',
    error: 'The run {run} ({strategy}) ended with an error (exit {exit}). No result was written.',
    errorNoExit: 'The run {run} ({strategy}) ended with an error. No result was written.',
    earlier: 'and {n} earlier',
    open: 'Open in RUN',
    openLabel: 'Open in RUN, {run}',
    dismiss: 'Dismiss',
    dismissLabel: 'Dismiss the finish notice',
    group: 'Finished backtest jobs',
  },

  span: {
    seconds: '{s} s',
    minutes: '{m} min {s} s',
    hours: '{h} h {m} min',
  },

  anchor: {
    match: 'MATCH',
    mismatch: 'MISMATCH',
    notComparable: 'NOT COMPARABLE',
    sentence: 'Anchor {word}: {detail}',
    matchDetail: 'trades, P&L, fees and Sharpe equal those of {base}.',
    mismatchDetail: 'the first difference against {base} is {field}.',
    noBase: 'the base run was not found.',
    unusable: 'a run is unusable or a count is missing.',
    baseUnknown: 'its base',
    fields: { trades: 'the trade count', pnl: 'total P&L', fees: 'total fees', sharpe: 'the Sharpe ratio', unknown: 'a field this check does not name' },
    sharpeDetail: 'the Sharpe ratio ({anchor} against {base})',
    tradeRow: 'the trade row field {field}',
    label: 'Anchor re-run result',
  },

  panel: {
    menuRun: 'Re-run this run as a regression anchor',
    menuMarked: 'Re-run the marked row as a regression anchor',
    menuNewest: 'Re-run the newest row as a regression anchor',
    heading: 'Regression anchor re-run of {base}',
    note: 'Runs the same configuration again under a new id in the backtest queue, then compares trades, P&L, fees and Sharpe with {base}. It writes no ledger row. This is an exact comparison, not the formal regress_check file, which only the lab scripts write.',
    close: 'Close',
    noBase: 'There is no run to re-run here.',
  },

  rerun: {
    button: 'Re-run anchor',
    buttonLabel: 'Re-run anchor, {base}',
    starting: 'Starting the anchor re-run of {base}.',
    queued: 'Anchor re-run {run} is {state}.',
    waitingResult: 'Anchor re-run {run} finished. Reading the comparison.',
    refused: 'The anchor re-run of {base} was not started: {detail}',
    ended: 'Anchor re-run {run} ended without a result ({state}).',
    noComparison: 'Anchor re-run {run} finished, but the comparison could not be read.',
    again: 'Re-run again',
    againLabel: 'Re-run again, {base}',
    openRun: 'Open in RUN, {run}',
    group: 'Anchor re-run of {base}',
  },
} as const
