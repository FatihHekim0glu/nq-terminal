// What the tear sheet's numbers came from, for GRAB's caption (roadmap 15): the Analytics answer the sheet
// already holds says its tags, basis, unit, window and sessions, and names its own request through
// tearAnalyticsPath (the one place that path is built). The image also holds figures from other GETs (the
// bootstrap cone, the /extended market context, a run's books): tearSources lists them and they ride in
// `alsoSources`; a run's [PROBE: never a result] and [ANCHOR] ride in `extraTags`. Pure: nothing is asked or
// recomputed here.
import { GRAB } from '../../copy/grab'
import { fillCopy } from '../../copy/workspace'
import type { GrabProvenance } from '../../export/grab/grabModel'
import { tearTags, type Analytics } from './tearKpis'
import type { TearTarget } from './tearQueries'
import { tearAnalyticsPath } from './tearSource'

export interface TearProvenanceOptions {
  /** Tags after the sheet's own, already bracketed: a run's `[PROBE: never a result]` and `[ANCHOR]`. */
  readonly extraTags?: readonly string[]
  /** GET paths of the other figures on the image (tearSources, after the analytics path), joined into the source. */
  readonly alsoSources?: readonly string[]
}

/**
 * The provenance of the tear sheet for `target`. `specSha` is the hypothesis card's spec hash (null for a
 * run, or while the card has not arrived). The sheet's tags are written with their brackets, then `extraTags`.
 * The source is the analytics path, then `alsoSources`, joined by GRAB.caption.pair.
 */
export function tearProvenance(data: Analytics, target: TearTarget, specSha: string | null, opts: TearProvenanceOptions = {}): GrabProvenance {
  const { extraTags = [], alsoSources = [] } = opts
  return {
    tags: [...tearTags(data).map((tag) => `[${tag}]`), ...extraTags],
    basis: fillCopy(GRAB.caption.basis, { basis: data.basis, label: data.basis_label }),
    unit: data.unit,
    window: fillCopy(GRAB.caption.window, { first: data.first, last: data.last }),
    n: data.n,
    source: [tearAnalyticsPath(target, data.context), ...alsoSources].join(GRAB.caption.pair),
    specSha,
  }
}
