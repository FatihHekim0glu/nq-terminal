// Copy the record watch's reader posts (roadmap 16): WATCH SEEN <GO> and the first visit that could not keep a
// checkpoint. It loads with the reader (chrome/RecordWatch.live.tsx), after the first idle moment, so the shell
// never holds it; the status line texts are in copy/watch.ts. UK spelling, no dashes. `{name}` slots are filled by
// fillCopy().

export const WATCH_READ = {
  /** What WATCH SEEN <GO> posts; the time is Eastern. */
  seen: 'Marked as seen at {time} ET.',
  /** WATCH SEEN <GO> when this browser refused to keep the mark. */
  unsaved: 'This browser could not keep the mark, so nothing was marked as seen.',
  /** The first visit when this browser could not keep the checkpoint: nothing is being compared. */
  unkept: 'This browser could not keep a watch checkpoint, so changes to the records are not being watched.',
} as const
