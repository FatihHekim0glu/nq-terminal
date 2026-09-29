// What each panel's numbers came from, for GRAB's caption (roadmap 15), and what a panel can hand to the
// evidence pack (roadmap 15 part 2). A screen registers its provenance and, where it holds the answers of
// a tear sheet or a hypothesis description, a dossier closure while it is mounted (usePanelSource), keyed
// by the panel it sits in; GRAB and the pack read them back. Nothing is fetched or computed here: a screen
// states what it already holds.
// Imported by screens (lazy chunks), by the Workspace's export menu and by the lazy export code, never by the shell.
import { useEffect } from 'react'
import type { DossierInput } from '../export/dossier/types'
import type { GrabProvenance } from '../export/grab/grabModel'
import { usePanelActions } from './PanelChrome.actions'

/** The answers a panel already holds, as the dossier input; null when it holds none right now. Never fetches. */
export type DossierSource = () => DossierInput | null

export interface PanelSource {
  readonly provenance: GrabProvenance | null
  /**
   * The dossier of what the panel holds (the evidence pack). Read it through panelDossier(), not through
   * panelSource(): a chart drawn inside the screen may register its own provenance after the screen did,
   * and the two are kept apart so neither shadows the other.
   */
  readonly dossier?: DossierSource
}

/** One registration; the wrapper keeps a disposer from removing a later registration of the same object. */
interface Entry {
  readonly source: PanelSource
}

// A panel keeps ONE provenance and ONE dossier, each latest-wins on its own. They are separate because a
// screen registers its dossier for the whole panel while a chart inside it registers the provenance of
// the picture it draws (DES: the equity chart on Profile); one shared slot would let either one hide the other.
const provenances = new Map<string, Entry>()
const dossiers = new Map<string, Entry>()

/**
 * Registers `source` for the panel (the latest registration wins, separately for provenance and dossier);
 * returns the disposer for this one only. A source with a dossier and no provenance (provenance null) claims
 * the dossier slot alone and leaves the provenance another registration made in place.
 */
export function registerPanelSource(id: string, source: PanelSource): () => void {
  const entry: Entry = { source }
  const hasDossier = source.dossier !== undefined
  if (source.provenance !== null || !hasDossier) provenances.set(id, entry)
  if (hasDossier) dossiers.set(id, entry)
  return () => {
    if (provenances.get(id) === entry) provenances.delete(id)
    if (dossiers.get(id) === entry) dossiers.delete(id)
  }
}

/** The provenance registration of the panel, or null when there is none. */
export function panelSource(id: string): PanelSource | null {
  return provenances.get(id)?.source ?? null
}

/** The dossier closure of the panel, or null when its screen holds nothing a dossier can be made from. */
export function panelDossier(id: string): DossierSource | null {
  return dossiers.get(id)?.source.dossier ?? null
}

/** Forgets every registration (tests). */
export function resetPanelSources(): void {
  provenances.clear()
  dossiers.clear()
}

/**
 * Registers what this screen's numbers came from, and the dossier it can hand to the evidence pack, while it
 * is mounted (keep `source` stable with useMemo). Does nothing without a source or outside a workspace panel.
 */
export function usePanelSource(source: PanelSource | null): void {
  const { panelId } = usePanelActions()
  useEffect(() => (panelId && source ? registerPanelSource(panelId, source) : undefined), [panelId, source])
}
