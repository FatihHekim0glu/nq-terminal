// The metrics HL search can find: one row per docs/ANALYTICS_CATALOG.md metric that a built screen shows,
// with the function whose screen holds its card (each placement read in the screen code). Only
// commands/searchIndex.ts reads this file, so it loads with the lazy search index and stays out of the
// shell. UK spelling, no em or en dashes. `aliases` are other names a reader might type.
import type { MnemonicCode } from '../commands/registry'

export interface MetricEntry {
  /** The catalogue id, for example PF6. */
  readonly id: string
  readonly label: string
  /** The function that shows it: HL runs this code, so a context-taking one uses the focused panel's. */
  readonly code: MnemonicCode
  readonly aliases?: readonly string[]
}

export const METRIC_ENTRIES: readonly MetricEntry[] = [
  // The tear sheet's KPI row shows PF2 to PF6, SV1, SV2, BR1 and BR2 above every tab; EQ is its first tab.
  { id: 'PF1', label: 'Equity curve', code: 'EQ', aliases: ['cumulative return'] },
  { id: 'PF2', label: 'Total return and CAGR', code: 'EQ', aliases: ['annualised return', 'compound annual growth rate'] },
  { id: 'PF3', label: 'Annualised volatility', code: 'EQ', aliases: ['vol', 'standard deviation'] },
  { id: 'PF4', label: 'Sharpe ratio with its interval', code: 'EQ' },
  { id: 'PF5', label: 'Sortino ratio', code: 'EQ', aliases: ['downside deviation'] },
  { id: 'PF6', label: 'Calmar ratio', code: 'EQ', aliases: ['return over drawdown'] },
  { id: 'PF7', label: 'Omega ratio', code: 'RET' },
  { id: 'PF8', label: 'Tail ratio', code: 'RET' },
  { id: 'PF9', label: 'Gain to pain', code: 'RET', aliases: ['gain to pain ratio'] },
  { id: 'PF10', label: 'Statistics table (hit rate, skew, kurtosis)', code: 'RET', aliases: ['skewness'] },
  { id: 'DD1', label: 'Underwater drawdown', code: 'DD', aliases: ['max drawdown', 'maximum drawdown'] },
  { id: 'DD2', label: 'Top 10 drawdowns', code: 'DD', aliases: ['worst drawdowns'] },
  { id: 'RL1', label: 'Rolling Sharpe', code: 'RR' },
  { id: 'RL2', label: 'Rolling volatility', code: 'RR', aliases: ['rolling vol'] },
  { id: 'RL3', label: 'Rolling beta', code: 'RR' },
  { id: 'RL4', label: 'Rolling correlation', code: 'RR' },
  { id: 'RL5', label: 'Block results', code: 'BLK', aliases: ['blocks'] },
  { id: 'RD1', label: 'Return histogram', code: 'RET', aliases: ['distribution'] },
  { id: 'RD2', label: 'Monthly returns', code: 'MRET', aliases: ['calendar returns', 'heat map'] },
  { id: 'RD3', label: 'QQ plot', code: 'RET', aliases: ['quantile plot', 'normality'] },
  { id: 'RD4', label: 'Jarque-Bera', code: 'RET', aliases: ['jb test', 'normality'] },
  { id: 'RK1', label: 'Historical VaR and CVaR', code: 'RET', aliases: ['value at risk', 'expected shortfall'] },
  { id: 'RK2', label: '21-session loss distribution', code: 'RET', aliases: ['tail losses'] },
  { id: 'RK3', label: 'Cornish-Fisher VaR', code: 'RET', aliases: ['cornish fisher'] },
  { id: 'RK5', label: 'Stress windows', code: 'RET', aliases: ['stress test'] },
  { id: 'BR1', label: 'Alpha and beta', code: 'EQ', aliases: ['capm', 'regression'] },
  { id: 'BR2', label: 'Information ratio and tracking error', code: 'EQ', aliases: ['active return'] },
  { id: 'BR3', label: 'Up and down capture', code: 'RR', aliases: ['capture ratio'] },
  { id: 'BR4', label: 'Strategy against benchmark', code: 'RR', aliases: ['scatter'] },
  { id: 'RG1', label: 'Volatility regimes', code: 'RR', aliases: ['regime'] },
  { id: 'SV1', label: 'Probabilistic Sharpe (PSR)', code: 'EQ' },
  { id: 'SV2', label: 'Minimum track record length (MinTRL)', code: 'EQ', aliases: ['track record'] },
  { id: 'SV3', label: 'Deflated Sharpe', code: 'MT', aliases: ['dsr', 'deflated sharpe ratio'] },
  { id: 'SV4', label: 'Multiple testing', code: 'MT', aliases: ['bonferroni', 'holm', 'false discovery'] },
  { id: 'SV5', label: 'Bootstrap intervals', code: 'EQ', aliases: ['confidence intervals'] },
  { id: 'SV6', label: 'Resampled cone', code: 'EQ', aliases: ['cone'] },
  { id: 'SV7', label: 'Sharpe difference (m - BH)', code: 'RET' },
  { id: 'SV9', label: 'Power and minimum detectable Sharpe', code: 'MT', aliases: ['power', 'mde'] },
  // A run's trade, path and slippage cards sit under the tear sheet's tabs (RunBooks), not on RUN.
  { id: 'TA1', label: 'Trade statistics', code: 'EQ', aliases: ['win rate', 'profit factor', 'expectancy'] },
  { id: 'TA2', label: 'MAE and MFE', code: 'EQ', aliases: ['adverse excursion', 'favourable excursion'] },
  { id: 'TA3', label: 'P&L by hour, weekday and month', code: 'EQ', aliases: ['pnl', 'profit and loss'] },
  { id: 'TA4', label: 'Holding time', code: 'EQ', aliases: ['trade duration'] },
  { id: 'TA5', label: 'Streaks', code: 'EQ', aliases: ['winning streak', 'losing streak'] },
  { id: 'TA6', label: 'Fill slippage', code: 'EQ' },
  { id: 'EX1', label: 'Exposure', code: 'EXPO', aliases: ['gross exposure', 'net exposure', 'leverage'] },
  { id: 'EX2', label: 'Turnover', code: 'EXPO' },
  { id: 'EX3', label: 'Cost waterfall', code: 'COST', aliases: ['costs'] },
  { id: 'EX4', label: 'Cost sensitivity', code: 'COST', aliases: ['cost ladder', 'break even'] },
  { id: 'MV1', label: 'Candles', code: 'GP', aliases: ['ohlc', 'price chart'] },
  { id: 'MV2', label: 'Roll gaps', code: 'ROLL', aliases: ['contract roll'] },
  { id: 'MV3', label: 'Realised volatility (RV22)', code: 'GP' },
  { id: 'MV4', label: 'Futures return heat map', code: 'MON', aliases: ['monitor'] },
  { id: 'MV5', label: 'Correlation matrix', code: 'CORR', aliases: ['correlations'] },
  { id: 'MV7', label: 'Seasonality', code: 'SEAS', aliases: ['calendar effect', 'day of week'] },
  { id: 'MV8', label: 'Event study', code: 'EVT', aliases: ['event window'] },
  { id: 'MV9', label: 'Volatility cone', code: 'VCONE' },
  { id: 'MV10', label: 'Roll calendar', code: 'ROLL', aliases: ['roll dates', 'expiry'] },
  { id: 'RI1', label: 'Spec hash check', code: 'REG', aliases: ['sha256', 'registry hash'] },
  { id: 'RI2', label: 'Gate access log', code: 'OOS', aliases: ['sealed reads', 'fence'] },
  { id: 'RI3', label: 'Ledger and anchors', code: 'LEDG' },
  { id: 'RI4', label: 'Data quality calendar', code: 'DQ', aliases: ['repaired days', 'gated days'] },
  { id: 'RI5', label: 'Guard fingerprint', code: 'DQ', aliases: ['guards'] },
  { id: 'LV1', label: 'Plumbing labels', code: 'JRNL' },
  { id: 'LV2', label: 'Target against actual', code: 'LIVE', aliases: ['reconciliation'] },
  { id: 'LV3', label: 'Guard and state strip', code: 'LIVE' },
  { id: 'LV4', label: 'Journal table', code: 'JRNL', aliases: ['journal'] },
  { id: 'LV5', label: 'Paper against model tracking', code: 'LIVE', aliases: ['paper tracking'] },
]
