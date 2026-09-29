// The dossier model (roadmap #15 part 2): what the evidence pack (W9) and the print dossier (W10) render.
// Plain data, all of it text already formatted by the screens' own formatters: a consumer only lays it out,
// so it never formats, rounds or computes a number. No DOM and no request lives in this folder's model files.
import type { HypothesisCard, HypothesisDetail } from '../../screens/des/desModel'
import type { Analytics } from '../../screens/tear/tearKpis'
import type { TearTarget } from '../../screens/tear/tearQueries'
import type { TearCode } from '../../screens/tear/TearSheet'

/** A tear sheet as the browser holds it. */
export interface TearDossierInput {
  readonly kind: 'tear'
  readonly target: TearTarget
  /** The tab open in the panel. The dossier covers every tab, so its content does not depend on it; the caller may name a file after it. */
  readonly tab: TearCode
  readonly analytics: Analytics
  /** The hypothesis card when the target is a hypothesis whose card is loaded; null for a run. */
  readonly card: HypothesisCard | null
}

/** A hypothesis description as the browser holds it. */
export interface DesDossierInput {
  readonly kind: 'des'
  readonly detail: HypothesisDetail
  /** The hypothesis tear sheet the browser already holds; null when it was never opened. */
  readonly analytics: Analytics | null
}

/** What a panel hands over: the answers it already holds, and nothing it would have to fetch. */
export type DossierInput = TearDossierInput | DesDossierInput

/** The moment and the honesty flags the dossier is made under. */
export interface DossierContext {
  /** The browser clock at the moment the dossier is made. */
  readonly now: Date
  /** The demo build: every answer is a fixture capture served in the browser. */
  readonly demo: boolean
  /** The backend runs on fixture data (health.fixture_mode). */
  readonly fixture: boolean
  /** The server clock of the last health answer (ISO, UTC); null when none is known. */
  readonly asOfUtc: string | null
}

/** A grid of text cells: `rows` are as wide as `columns`. */
export interface DossierTable {
  readonly kind: 'table'
  readonly id: string
  readonly title: string
  /** Basis, unit and tag of the figures, and anything the reader needs to read them; null when none. */
  readonly note: string | null
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

/** Lines of prose. `verbatim` marks text quoted from a research file, to be laid out as it is. */
export interface DossierText {
  readonly kind: 'text'
  readonly id: string
  readonly title: string
  readonly lines: readonly string[]
  readonly verbatim: boolean
}

export type DossierSection = DossierTable | DossierText

export interface Dossier {
  readonly title: string
  readonly subtitle: string
  /** Bracketed tags and data flags shown under the title: [FAIL], [PRE-REG], DEMO DATA. */
  readonly flags: readonly string[]
  /** Label and value pairs describing the series or the registration. */
  readonly meta: readonly (readonly [string, string])[]
  /** The answer first: the figures the reader came for. */
  readonly story: readonly DossierSection[]
  /** The proof behind it. */
  readonly evidence: readonly DossierSection[]
  /** Where each answer came from, one GET per line. */
  readonly sources: readonly string[]
  /** The closing lines: what the dossier is, when it was made, the fence, the demo note. */
  readonly footer: readonly string[]
}

/** A chart as an image of the panel as it was on screen (made by the caller, never by this model). */
export interface DossierFigure {
  /** A `data:image/png;base64,...` URL. */
  readonly dataUrl: string
  /** The chart's accessible summary, its text alternative. */
  readonly summary: string
  readonly width: number
  readonly height: number
}
