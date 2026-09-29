// The leaf of the record watch's grid marks (roadmap 16): the marks store and its hook, with nothing else. It is
// the leaf so the lazy screens (RUNS, REG, LEDG) never pull RecordWatch.live into a shared chunk: importing the
// live module there splits the API client and safe storage out of the shell (state/recordWatch.marks.split.test.ts).
// RecordWatch.live writes the marks after each read; the screens only read them.
import { create } from 'zustand'
import type { WatchSource } from '../state/recordWatch.schema'

export type WatchMark = 'new' | 'changed'
export type WatchMarks = Readonly<Record<WatchSource, ReadonlyMap<string, WatchMark>>>

const NO_MARKS = new Map<string, WatchMark>()
/** Nothing marked in any of the six sources. */
export const EMPTY_MARKS: WatchMarks = { registry: NO_MARKS, confirmations: NO_MARKS, openings: NO_MARKS, ledger: NO_MARKS, oos: NO_MARKS, runs: NO_MARKS }

/** The marks the grids show; RecordWatch.live sets them, and resetRecordWatchView clears them. */
export const useWatchMarksStore = create<{ readonly marks: WatchMarks }>()(() => ({ marks: EMPTY_MARKS }))

/** The rows of one source that are new or rewritten, by the key the watch uses for that source. */
export function useWatchMarks(source: WatchSource): ReadonlyMap<string, WatchMark> {
  return useWatchMarksStore((s) => s.marks[source])
}
