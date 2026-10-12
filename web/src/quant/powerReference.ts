// [POST HOC] Basis A. The browser's own power table over a Deflated Sharpe view: a TEST REFERENCE since the backend
// serves SV9 (analytics/power.py, GET /api/analytics/power; ANALYTICS_CATALOG C8). No production file imports this
// module, power or normal (src/quant/importGuard.test.ts fails the build if one does): the screens show the served
// table, and the tests here pin the served figures to this independent browser computation and to the scipy golden
// vectors of qa/crosscheck/p12_power.py.
import type { DeflatedView } from '../screens/reg/deflatedModel'
import { POWER_TAG, POWER_TARGET, REFERENCE_SHARPE, type PowerFamily, type PowerRow, type PowerView } from '../screens/reg/powerModel'
import { minimumDetectableSharpe, powerAtSharpe, trackYears } from './power'

/** A number, or null for NaN, an infinity or a missing value: the table prints null as `--`. */
type Figure = number | null

function figure(value: number | null | undefined): Figure {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function familyAlpha(family: PowerFamily): Figure {
  return Number.isFinite(family.k) && family.k > 0 ? figure(family.alpha / family.k) : null
}

/** The MDE and power of one trial at one alpha; both null when the alpha is not usable. */
function atAlpha(row: DeflatedView['rows'][number], alpha: Figure): { readonly mde: Figure; readonly power: Figure } {
  if (alpha === null) return { mde: null, power: null }
  return {
    mde: figure(minimumDetectableSharpe(row.n, row.periods, alpha, POWER_TARGET)),
    power: figure(powerAtSharpe(REFERENCE_SHARPE, row.n, row.periods, alpha)),
  }
}

function ratioOf(sharpe: Figure, mdeFamily: Figure): Figure {
  return sharpe === null || mdeFamily === null || mdeFamily <= 0 ? null : figure(sharpe / mdeFamily)
}

/** One PowerRow per registered trial of the Deflated Sharpe view, in its order, computed in the browser. */
export function powerView(view: DeflatedView, family: PowerFamily): PowerView {
  const alphaFamily = familyAlpha(family)
  const rows = view.rows.map((row): PowerRow => {
    const nominal = atAlpha(row, figure(family.alpha))
    const wide = atAlpha(row, alphaFamily)
    const sharpe = figure(row.annual_sharpe)
    return {
      name: row.name,
      kind: row.kind,
      periods: row.periods,
      n: row.n,
      years: figure(trackYears(row.n, row.periods)),
      sharpe,
      mdeNominal: nominal.mde,
      mdeFamily: wide.mde,
      ratio: ratioOf(sharpe, wide.mde),
      powerNominal: nominal.power,
      powerFamily: wide.power,
    }
  })
  return { tag: POWER_TAG, basis: 'A', family, alphaFamily, rows }
}
