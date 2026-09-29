// The one entry point of the record watch's lazy chunk (roadmap 16). The shell reaches the diff, the list
// and the long copy only through import('./RecordWatch.lazy') in RecordWatch.live.tsx, so none of them
// lands in the shell (state/recordWatch.split.test.ts guards it). Add nothing else here.
export { diffWatch, extendCheckpoint, mergeAccepted, snapshotOf } from '../state/recordWatch'
export { bootText, itemText, watchMenu } from './RecordWatch.menu'
