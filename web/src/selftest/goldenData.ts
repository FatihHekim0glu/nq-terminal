// The four golden files of qa/golden, bundled into the self-test page as text (`?raw`) and parsed on demand. A fresh copy on
// every read, so a test can change one number of its own copy. Only the fields the page's checks read are typed.
import expectationRaw from '../../../qa/golden/p12_expectation.json?raw'
import neffRaw from '../../../qa/golden/p12_neff.json?raw'
import powerRaw from '../../../qa/golden/p12_power.json?raw'
import servedRaw from '../../../qa/golden/p2_neff_served.json?raw'

type Band = 'below5' | 'p5to25' | 'p25to50' | 'p50to75' | 'p75to95' | 'above95'
type Matrix = number[][]
type Clusters = number[][]

export interface ExpectationCase {
  name: string
  input: { usd: Array<number | null>; capital: number; horizon: number; quantiles: Record<'5' | '25' | '50' | '75' | '95', Array<number | null>> }
  expected: { first_index: number | null; fraction: Array<number | null>; bands: Array<Band | null>; beyond: number }
}

export interface Merge {
  a: number
  b: number
  height: number
  size: number
}

export interface NeffGolden {
  panel: { names: string[]; dates: string[]; columns: number[][] }
  correlation: Matrix
  eigenvalues: number[]
  participation_ratio: number
  li_ji: number
  linkage: Merge[]
  linkage_heights: number[]
  cluster_cut: number
  clusters: Clusters
  cluster_sweep: Array<{ cut: number; clusters: Clusters }>
  inversion_case: { m: number; merges: Merge[]; cuts: Array<{ cut: number; clusters: Clusters }> }
  eigen_cases: Array<{ name: string; matrix: Matrix; eigenvalues: number[]; participation_ratio: number; li_ji: number }>
  sr0_cases: Array<{ gamma: number; n_trials: number; variance: number; value: number | null }>
  psr_cases: Array<{ sr: number; sr0: number; n: number; skew: number; kurt: number; value: number | null }>
  session_sharpe: Array<{ name: string; value: number }>
}

export interface PowerGolden {
  cdf: Array<{ x: number; value: number }>
  quantile: Array<{ p: number; value: number }>
  mde: Array<{ n: number; periods: number; alpha: number; power: number; value: number }>
  power: Array<{ sharpe: number; n: number; periods: number; alpha: number; value: number }>
}

/** The served views of the bridge file: read here as plain data and compared as a whole, so they are typed loosely. */
export interface ServedGolden {
  sv3b: Record<string, unknown> & { effective_n: Record<string, unknown> & { daily: string[]; eigenvalues: number[]; dsr: Array<{ served: number | null }> } }
  sv8: Array<{ name: string; names: string[]; correlation: Array<Array<number | null>>; served: Record<string, unknown> & { participation: number | null } }>
}

export interface GoldenData {
  p12_expectation: { cases: ExpectationCase[] }
  p12_neff: NeffGolden
  p12_power: PowerGolden
  p2_neff_served: ServedGolden
}

export function readGoldenData(): GoldenData {
  return {
    p12_expectation: JSON.parse(expectationRaw) as GoldenData['p12_expectation'],
    p12_neff: JSON.parse(neffRaw) as NeffGolden,
    p12_power: JSON.parse(powerRaw) as PowerGolden,
    p2_neff_served: JSON.parse(servedRaw) as ServedGolden,
  }
}
