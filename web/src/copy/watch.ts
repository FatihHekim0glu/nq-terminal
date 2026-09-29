// Copy for the research-record watch in the status line (roadmap 16). This is the part the shell holds;
// the longer texts of the WATCH <GO> list and the start-up line are in copy/watchDetail.ts, which loads
// with the diff, and what the reader posts (WATCH SEEN, a refused checkpoint) is in copy/watchReader.ts, which
// loads with the reader. UK spelling, no dashes. `{name}` slots are filled by fillCopy().

export const WATCH = {
  /** Bold key of the status line segment. */
  key: 'WATCH',
  /** First visit: nothing to compare with yet. */
  baseline: 'from now',
  clean: 'no change',
  news: '{n} new',
  changed: '{n} changed',
  /** Read out with the segment when a record that should never change was rewritten. */
  changedNote: 'A record that should not change was rewritten: WATCH <GO> lists it.',
  /** Header of the grid column that marks new and rewritten rows (RUNS, REG, LEDG). */
  column: 'Seen',
  /** The column's cue for a record that is new or moved since the checkpoint. */
  new: 'NEW',
  /** The column's cue for a record that should not change and was rewritten. */
  chg: 'CHG',
} as const
