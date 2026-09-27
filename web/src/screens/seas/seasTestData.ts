// A SEAS body for tests and the gallery, shaped as GET /api/seasonality/... answers (./types).
import type { SeasonBucket, SeasonPanel, Seasonality } from './types'

export const LABEL = '[POST HOC] descriptive, in-sample, not a registered test'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function bucket(key: number, label: string, n: number, mean: number | null, se: number | null, hit: number | null): SeasonBucket {
  return { key, label, n, mean, se, hit_rate: hit }
}

function panel(id: SeasonPanel['id'], buckets: SeasonBucket[], extra: Partial<SeasonPanel> = {}): SeasonPanel {
  const observation = id === 'month' ? 'one value per month and year' : id === 'intraday' ? 'one value per 30-minute bucket of a session' : 'one value per session'
  return { id, observation, available: true, note: null, buckets, excluded_sessions: null, source: null, ...extra }
}

export function makeSeasonality(over: Partial<Seasonality> = {}): Seasonality {
  const weekday = panel('weekday', [
    bucket(0, 'Mon', 100, 0.001, 0.0005, 0.55),
    bucket(1, 'Tue', 101, -0.0004, 0.0006, 0.48),
    bucket(2, 'Wed', 99, 0.0002, 0.0005, 0.52),
    bucket(3, 'Thu', 0, null, null, null),
    bucket(4, 'Fri', 1, -0.002, null, 0),
  ])
  const month = panel('month', MONTHS.map((m, i) => bucket(i + 1, m, 2, (i % 3) * 0.004 - 0.002, 0.003, 0.5)))
  const wom = panel('week_of_month', ['W1', 'W2', 'W3', 'W4', 'W5'].map((w, i) => bucket(i + 1, w, 50 - i, 0.0003 * (i - 2), 0.0004, 0.5)))
  const labels = Array.from({ length: 13 }, (_, i) => {
    const minutes = 9 * 60 + 30 + 30 * i
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  })
  const intraday = panel('intraday', labels.map((l, i) => bucket(i, l, 240, 0.0001 * (6 - i), 0.00005, 0.5)), {
    excluded_sessions: 4,
    source: 'qa.day_gate',
  })
  return {
    subject: 'NQ.V.0',
    kind: 'instrument',
    label: LABEL,
    basis: 'daily r = dB / (N - dB)',
    unit: 'fraction of the previous price (0.01 is 1%)',
    fraction: true,
    aggregation: 'compound',
    error_bar: 'one standard error of the mean',
    first: '2020-01-02',
    last: '2021-12-31',
    sessions: 504,
    start_year: 2020,
    end_year: 2021,
    variant: 'repaired',
    cost: null,
    panels: [month, weekday, wom, intraday],
    heatmap: {
      years: [2020, 2021],
      months: MONTHS,
      values: [
        [0.02, -0.01, 0.005, null, null, null, null, null, null, null, null, 0.01],
        [-0.01, 0.03, null, null, null, null, null, null, null, null, null, null],
      ],
      sessions: [
        [20, 19, 21, 0, 0, 0, 0, 0, 0, 0, 0, 22],
        [19, 19, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ],
    },
    gate: { caller: 'terminal', served_years: [2010, 2020, 2021], cached: false, reads_this_process: 3 },
    ...over,
  }
}
