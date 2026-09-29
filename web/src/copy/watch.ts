// Copy for the research-record watch in the status line (roadmap 16). This is the part the shell holds;
// the longer texts of the WATCH <GO> list and the start-up line are in copy/watchDetail.ts, which loads
// with the diff. UK spelling, no dashes. `{name}` slots are filled by fillCopy().

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
  /** What WATCH SEEN <GO> posts; the time is Eastern. */
  seen: 'Marked as seen at {time} ET.',
  /** WATCH SEEN <GO> when this browser refused to keep the mark. */
  unsaved: 'This browser could not keep the mark, so nothing was marked as seen.',
  /** The first visit when this browser could not keep the checkpoint: nothing is being compared. */
  unkept: 'This browser could not keep a watch checkpoint, so changes to the records are not being watched.',
} as const
