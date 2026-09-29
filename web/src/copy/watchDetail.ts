// Copy for the WATCH <GO> list and the start-up line of the research-record watch (roadmap 16). This
// module loads only with the diff (chrome/RecordWatch.lazy.ts), so the shell never holds it; the short
// status line texts are in copy/watch.ts. The list is a local change watch, not a proof: it says so.
// UK spelling, no dashes. `{name}` slots are filled by fillCopy().

export const WATCH_DETAIL = {
  menuTitle: 'Since your last visit',
  intro: 'Local change watch from this browser, not a proof. Compared with {since} ET.',
  introBaseline: 'Watching from {since} ET: nothing to compare yet.',
  none: 'Nothing new or changed since {since} ET.',
  more: 'More items: open the screens for the full lists.',
  seenDetail: 'Mark all of this as seen',
  /** Posted once when the page opens and something differs. */
  boot: 'Since {since} ET: {parts}. WATCH <GO> lists them.',
  joiner: ', ',
  part: '{n} {what}',
  /** What a count of records in each set counts. */
  what: {
    registry: 'registry rows',
    confirmations: 'confirmations',
    openings: 'openings',
    ledger: 'ledger rows',
    oos: 'gate log lines',
    runs: 'runs',
  },
  /** The same names for a count of exactly one. */
  whatOne: {
    registry: 'registry row',
    confirmations: 'confirmation',
    openings: 'opening',
    ledger: 'ledger row',
    oos: 'gate log line',
    runs: 'run',
  },
  itemAppended: '{source} {key} added',
  itemUpdated: '{source} {key}: {field} {before} to {after}',
  itemChanged: '{source} {key}: {field} was {before}, now {after}',
  itemRemoved: '{source} {key} is gone',
  itemShortened: 'gate log shortened from {before} to {after} lines',
  /** A field with no value. */
  noValue: 'none',
  sources: {
    registry: 'registry',
    confirmations: 'confirmation',
    openings: 'opening',
    ledger: 'ledger',
    oos: 'gate log',
    runs: 'run',
  },
} as const
