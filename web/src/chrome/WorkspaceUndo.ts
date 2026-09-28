// A 10 deep undo ring for the workspace's layout changes (roadmap #6, layout safety): one entry per
// change, reset or dropped saved layout, oldest first. Pure; WorkspaceController owns when an entry is
// pushed or popped.
import type { MnemonicCode } from '../commands/registry'
import type { GroupRecord, LinkContext } from '../state/linkGroups'

export const UNDO_DEPTH = 10

export type UndoCause = 'change' | 'reset' | 'dropped'

export interface UndoEntry {
  readonly screen: MnemonicCode
  /** The dockview JSON the screen showed before this change; untrusted once it comes back off the ring. */
  readonly dock: Readonly<Record<string, unknown>>
  /** What the layouts store held for `screen` before this change, or null when it was never saved. */
  readonly stored: Readonly<Record<string, unknown>> | null
  readonly contexts: GroupRecord<LinkContext | null>
  readonly cause: UndoCause
}

/** Oldest first; the newest entry (what UNDO restores next) is the last one. */
export type UndoRing = readonly UndoEntry[]

export const EMPTY_RING: UndoRing = Object.freeze([])

function sameChange(a: UndoEntry, b: UndoEntry): boolean {
  return a.screen === b.screen && JSON.stringify(a.dock) === JSON.stringify(b.dock)
}

/** Appends `entry`, dropping the oldest past 10; skipped when it is the same screen and dock as the
 * newest entry already there (a command that touched nothing worth undoing again). */
export function pushUndo(ring: UndoRing, entry: UndoEntry): UndoRing {
  const newest = ring.at(-1)
  if (newest && sameChange(newest, entry)) return ring
  const next = [...ring, entry]
  return next.length > UNDO_DEPTH ? next.slice(next.length - UNDO_DEPTH) : next
}

/** The newest entry and the ring without it, or null when the ring is empty. */
export function popUndo(ring: UndoRing): { readonly ring: UndoRing; readonly entry: UndoEntry } | null {
  const entry = ring.at(-1)
  if (!entry) return null
  return { ring: ring.slice(0, -1), entry }
}
