// What a dossier is made from (roadmap 15 part 2), shared by the evidence pack and the print dossier. The
// panel hands over a closure of the answers it already holds (panelSources.ts); the charts on screen are
// copied as PNG data URLs, each kept only when it matches PNG_DATA_URL. Nothing is fetched or recomputed
// here: the dossier is the panel as it is now. Lazy code: only the dynamic imports in the Workspace's
// export menu reach it, so neither this file nor the dossier copy is part of the first load.
import { panelElement } from '../chrome/KeyToolbar.panels'
import { panelDossier } from '../chrome/panelSources'
import { DOSSIER } from '../copy/dossier'
import { GRAB } from '../copy/grab'
import { buildDossier } from './dossier/dossierModel'
import type { Dossier, DossierContext, DossierFigure } from './dossier/types'
import { collectFigures, type GrabFigure } from './grab/collect'
import { composeFigure } from './grab/compose'
import { grabFileName } from './grab/grabModel'
import type { HealthLite } from './grab/run'

/**
 * A PNG as a data address, and nothing else: no other type, no whitespace, no quote, no tag after it.
 * Anchored at both ends and not global, so a test() call carries no state. Every image that enters a
 * dossier passes it here, and the pack renderer checks it again before it writes an image.
 */
export const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/

const PNG = 'image/png'

/** What the dossier is made from: the dossier itself, its charts, how many charts were left out, and the file stem. */
export interface ExportJob {
  readonly dossier: Dossier
  readonly figures: DossierFigure[]
  /** Charts left out: drawn without a canvas (SVG), or a canvas the browser would not export as a PNG. */
  readonly skipped: number
  /** The panel title cleaned as GRAB's file names are, with no time stamp and no extension. */
  readonly fileStem: string
}

export interface PrepareRequest {
  readonly panelId: string
  /** The cached health answer, or null when there is none (the dossier then has no server clock). */
  readonly health: HealthLite | null
  readonly now?: Date
}

/** The `_YYYYMMDD-HHMMSSZ.png` GRAB's file name ends in; taken off to leave the stem. */
const GRAB_SUFFIX = /_\d{8}-\d{6}Z\.png$/

/** The chart canvas as a PNG data address, or null when the browser will not give one (a tainted canvas throws). */
function pngOf(canvas: unknown): string | null {
  const drawing = canvas as { toDataURL?: (type: string) => unknown } | null
  if (drawing === null || typeof drawing.toDataURL !== 'function') return null
  try {
    const url = drawing.toDataURL(PNG)
    return typeof url === 'string' && PNG_DATA_URL.test(url) ? url : null
  } catch {
    return null
  }
}

function figureOf(figure: GrabFigure, dpr: number): DossierFigure | null {
  const dataUrl = pngOf(composeFigure(figure, dpr))
  return dataUrl === null ? null : { dataUrl, summary: figure.summary, width: figure.width, height: figure.height }
}

/**
 * The job for a panel: its dossier (null closure or none registered gives DOSSIER.unavailable; a panel not
 * on the page gives GRAB.noPanel) and its charts. A closure that throws lets the error through for the
 * caller to report.
 */
export function prepareExport(req: PrepareRequest): ExportJob | { readonly message: string } {
  const input = panelDossier(req.panelId)?.() ?? null
  if (input === null) return { message: DOSSIER.unavailable }
  const panel = panelElement(req.panelId)
  if (!panel) return { message: GRAB.noPanel }
  const now = req.now ?? new Date()
  const ctx: DossierContext = {
    now,
    demo: document.documentElement.dataset.demo === 'on',
    fixture: req.health?.fixture_mode === true,
    asOfUtc: req.health?.now_utc ?? null,
  }
  const dossier = buildDossier(input, ctx)
  const { figures: collected, skipped } = collectFigures(panel)
  const dpr = globalThis.devicePixelRatio || 1
  const figures: DossierFigure[] = []
  for (const figure of collected) {
    const made = figureOf(figure, dpr)
    if (made !== null) figures.push(made)
  }
  const title = panel.getAttribute('data-nqt-title') ?? ''
  return {
    dossier,
    figures,
    skipped: skipped + (collected.length - figures.length),
    fileStem: grabFileName(title, now).replace(GRAB_SUFFIX, ''),
  }
}
