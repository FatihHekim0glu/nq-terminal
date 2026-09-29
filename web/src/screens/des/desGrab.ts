// What DES's numbers came from, for GRAB's caption (roadmap 15): the hypothesis card the screen already holds
// says its registration tag, its headline basis and unit, the sessions behind the headline value and its spec
// hash, and the card's own GET is the source. The Profile equity chart is not the card's: it is the terminal's
// own panel (GET .../panel), [POST HOC], so it is described from that answer (desEquityProvenance). A panel keeps
// ONE provenance (panelSources), so each tab registers exactly what it draws: desTabProvenance for the tabs that
// draw the card, and Profile (equity) and Robustness (forks) register their own from inside. Pure: nothing is
// asked or recomputed here.
import { buildApiUrl } from '../../api/client'
import type { ApiPath, Schemas } from '../../api/types'
import { DES } from '../../copy/des'
import { GRAB } from '../../copy/grab'
import { fillCopy } from '../../copy/workspace'
import type { GrabProvenance } from '../../export/grab/grabModel'
import type { HypothesisCard, HypothesisDetail } from './desModel'
import type { DesTab } from './desNumbers'

const HYPOTHESIS_PATH = '/api/hypotheses/{name}' satisfies ApiPath
const PANEL_PATH = '/api/analytics/hypothesis/{name}/panel' satisfies ApiPath

const bracketed = (tag: string): string => fillCopy(DES.tag, { tag })

/** The provenance of the DES page for `detail`: [PRE-REG] or [POST HOC], then [OVERLAY] for a risk overlay. */
export function desProvenance(detail: HypothesisDetail): GrabProvenance {
  const { card } = detail
  const tags = [bracketed(card.registered ? DES.preReg : DES.postHoc)]
  if (card.tag === 'overlay') tags.push(bracketed(DES.overlay))
  return {
    tags,
    basis: card.headline_basis ? fillCopy(GRAB.caption.basis, { basis: card.headline_basis, label: GRAB.caption.headline }) : null,
    unit: card.headline_unit,
    window: null,
    n: card.n,
    source: buildApiUrl(HYPOTHESIS_PATH, { path: { name: card.name } }),
    specSha: card.spec_sha256 || null,
  }
}

/**
 * The provenance of the Profile equity chart: the terminal's own panel answer for `card` at `cost`, so its own
 * tag ([POST HOC]), basis, unit, window and sessions, and the panel GET as the source (not the card's).
 */
export function desEquityProvenance(card: HypothesisCard, data: Schemas['HomePanel'], cost: number): GrabProvenance {
  return {
    tags: data.tag ? [data.tag] : [],
    basis: data.basis ? fillCopy(GRAB.caption.basis, { basis: data.basis, label: data.basis_label }) : null,
    unit: data.equity_unit,
    window: data.first && data.last ? fillCopy(GRAB.caption.window, { first: data.first, last: data.last }) : null,
    n: data.n,
    source: buildApiUrl(PANEL_PATH, { path: { name: card.name }, query: { cost } }),
    specSha: card.spec_sha256 || null,
  }
}

/**
 * The provenance HypothesisDes registers for the tab it shows, or null when the tab's own chart registers it
 * (Profile: the equity chart; Robustness: the forks). The Costs page draws the cost ladder and the blocks from
 * the card: the unit is named only when both share it, since the caption has room for one.
 */
export function desTabProvenance(detail: HypothesisDetail, tab: DesTab): GrabProvenance | null {
  if (tab === 'profile' || tab === 'robustness') return null
  const card = desProvenance(detail)
  if (tab !== 'costs') return card
  const { cost_ladder_unit: ladder, blocks_unit: blocks } = detail.des
  return { ...card, unit: ladder !== null && (blocks === null || blocks === ladder) ? ladder : null }
}

/**
 * The provenance of the Robustness page: the card's tag ([PRE-REG] or [POST HOC], then [OVERLAY]), then
 * [POST HOC] once a forks ladder is drawn (a fork is a terminal computation). The page mixes units and bases,
 * so basis, unit, window and sessions are left out. The source is the card GET, then the GET of each fork the
 * drawn ladders use (`forkPaths`, from forkRequestPath), joined by GRAB.caption.pair.
 */
export function desRobustnessProvenance(card: HypothesisCard, forkPaths: readonly string[]): GrabProvenance {
  const tags = [bracketed(card.registered ? DES.preReg : DES.postHoc)]
  if (card.tag === 'overlay') tags.push(bracketed(DES.overlay))
  const forks = bracketed(DES.postHoc)
  if (forkPaths.length > 0 && !tags.includes(forks)) tags.push(forks)
  return {
    tags,
    basis: null,
    unit: null,
    window: null,
    n: null,
    source: [buildApiUrl(HYPOTHESIS_PATH, { path: { name: card.name } }), ...forkPaths].join(GRAB.caption.pair),
    specSha: card.spec_sha256 || null,
  }
}
