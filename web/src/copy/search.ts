// Copy for HL search results (the shell reads this file; the metric list is in searchMetrics.ts, which
// only the lazy search index reads). UK spelling, no em or en dashes. `{group}`, `{label}`, `{id}`,
// `{screen}`, `{name}`, `{code}`, `{detail}` and `{phrase}` are filled in by fillCopy().

export const SEARCH = {
  /** The name of each kind of result, shown at the start of its detail. */
  groups: {
    function: 'Function',
    word: 'Command word',
    metric: 'Metric',
    instrument: 'Instrument',
    help: 'Help',
  },
  metricDetail: '{group}: {label} ({id}), {screen}',
  instrumentDetail: '{group}: {name}',
  /** The phrase is the help sentence around the match, in quotes. */
  helpDetail: '{group}: {code}, "{phrase}"',
  wordDetail: '{group}: {detail}',
  /** Shown above HL's results while the lazy index is still on its way. */
  loading: 'Help text and metrics are still loading: HL again in a moment to search them too.',
} as const
