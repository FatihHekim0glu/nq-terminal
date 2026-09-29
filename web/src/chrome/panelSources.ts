// What each panel's numbers came from, for GRAB's caption (roadmap 15). A screen registers its
// provenance while it is mounted (usePanelSource), keyed by the panel it sits in; GRAB reads it back
// when the panel is grabbed. Nothing is fetched or computed here: a screen states what it already holds.
// Imported by screens (lazy chunks) and by the lazy GRAB code, never by the shell.
import { useEffect } from 'react'
import type { GrabProvenance } from '../export/grab/grabModel'
import { usePanelActions } from './PanelChrome.actions'

export interface PanelSource {
  readonly provenance: GrabProvenance | null
}

/** One registration; the wrapper keeps a disposer from removing a later registration of the same object. */
interface Entry {
  readonly source: PanelSource
}

const entries = new Map<string, Entry>()

/** Registers `source` for the panel (the latest registration wins); returns the disposer for this one only. */
export function registerPanelSource(id: string, source: PanelSource): () => void {
  const entry: Entry = { source }
  entries.set(id, entry)
  return () => {
    if (entries.get(id) === entry) entries.delete(id)
  }
}

export function panelSource(id: string): PanelSource | null {
  return entries.get(id)?.source ?? null
}

/** Forgets every registration (tests). */
export function resetPanelSources(): void {
  entries.clear()
}

/**
 * Registers what this screen's numbers came from while it is mounted (keep `source` stable with
 * useMemo). Does nothing without a source or outside a workspace panel.
 */
export function usePanelSource(source: PanelSource | null): void {
  const { panelId } = usePanelActions()
  useEffect(() => (panelId && source ? registerPanelSource(panelId, source) : undefined), [panelId, source])
}
