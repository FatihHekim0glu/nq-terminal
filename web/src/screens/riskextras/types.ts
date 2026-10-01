// The body of GET /api/analytics/{hypothesis/{name}|run/{run_id}}/risk-extras (TASKS Phase 12; ANALYTICS_CATALOG
// RK4, PF11, BR5), as backend/nq_terminal/models/risk_extras.py declares it. The generated Schemas['RiskExtras'] is
// assignable to RiskExtrasView (RiskExtrasLive passes its query data straight in, so `tsc -b` pins that).
import type { Schemas } from '../../api/types'

type Kpi = Schemas['Kpi']
type Context = Schemas['Context']
type Num = number | null

export interface CornishFisherEsLevel {
  readonly level: '95' | '99'
  readonly tail: number
  readonly z: number
  readonly cf_quantile: Num
  readonly edgeworth_mean: Num
  readonly gaussian: Num
  readonly historical: Num
  readonly raw_expansion: Num
  /** Null outside the monotone domain or below zero (inverse risk). */
  readonly modified: Num
  /** The tile: the modified ES where defined, else the historical CVaR (RK1). */
  readonly value: Num
  readonly in_domain: boolean
  /** The operational floor was taken: the ES equals the modified VaR. */
  readonly floored: boolean
  readonly method: string
}

export interface CornishFisherEsView {
  readonly basis: 'A' | 'B'
  readonly unit: string
  readonly horizon: string
  readonly mean: Num
  readonly sigma: Num
  readonly skew: Num
  readonly excess_kurtosis: Num
  readonly domain: string
  readonly levels: readonly CornishFisherEsLevel[]
}

export interface TreynorView {
  readonly tile: Kpi
  readonly cagr: Num
  readonly beta: Num
  readonly n_pairs: number
  readonly bench_label: string | null
  readonly note: string | null
}

export interface RiskExtrasView {
  readonly context: Context
  readonly basis: 'A' | 'B'
  readonly unit: string
  readonly periods_per_year: number
  readonly n: number
  readonly tag: '[POST HOC]' | '[PRE-REG]'
  readonly descriptive: string
  readonly drawdown_tiles: readonly Kpi[]
  readonly modified_es: CornishFisherEsView
  readonly treynor: TreynorView
}
