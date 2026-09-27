// Copy for the P1 screens COST, BLK, EXPO and SEAL (TASKS 9.4; UI_SPEC section 7; look spec 7). UK
// spelling, no em or en dashes. `{token}` slots are filled by fillCopy(). Every value these screens show
// is the API's own (the same as DES and the run books); the copy only names it.

export const BOOKS = {
  actionsDes: 'Open DES',
  actionsRun: 'Open RUN',
  loading: 'Reading {name}.',
  failed: '{name} could not be read: {detail}',
  confirmationsFailed: 'The confirmation list could not be read, so {name} is not asked for: {detail}',
  basis: 'Basis A: the series the registered test used, read from the screen JSON, never recomputed.',
  unit: 'Unit: {unit}.',
  noContextTitle: 'No context',
} as const

export const COST = {
  title: 'Cost ladder',
  fieldHypothesis: 'Hypothesis or run',
  placeholder: 'rebal_v0 or a run id',
  empty: 'Give COST a hypothesis or a run, for example {rebal_v0 COST <GO>} or {nt_dtsmom_v0_ts1 COST <GO>}.',
  ladderTitle: 'Cost ladder of {name}',
  ladderCaption: 'Cost ladder of {name}: net value at each cost per side, {unit}',
  ladderCols: { n: 'No.', ticks: 'Cost per side', value: 'Net value' },
  ladderNone: 'The screen JSON records no cost ladder for {name}.',
  confirmation: '{name} is a sealed-window confirmation: its costs are in its own result. See {name} DES and {parent} SEAL.',
  waterfallTitle: 'Cost waterfall of {run}',
  byInstrumentTitle: 'Costs by instrument',
  byInstrumentCaption: 'Costs by instrument of {run}, {unit}',
  byInstrumentCols: { instrument: 'Instrument', sides: 'Contract sides', commissions: 'Commissions', slippage: 'Modelled slippage' },
  sensitivityTitle: 'Cost sensitivity of {run}',
  sensitivityCaption: 'Net P&L of {run} at each slippage cost per side',
  sensitivityCols: { ticks: 'Slippage per side', usd: 'Net P&L (USD)', pct: 'Net P&L (% of capital)' },
  costPerTick: 'One tick per side costs {usd} USD over the run.',
  exportName: 'cost',
  helpLine: 'COST HELP',
} as const

export const BLK = {
  title: 'Blocks',
  field: 'Hypothesis',
  placeholder: 'rebal_v0',
  empty: 'Give BLK a hypothesis, for example {rebal_v0 BLK <GO>}.',
  caption: 'Blocks of {name}: the block results the screen JSON recorded, {unit}',
  cols: { n: 'No.', block: 'Block', value: 'Value' },
  none: 'The screen JSON records no blocks for {name}.',
  confirmation: '{name} is a sealed-window confirmation and has no in-sample blocks. See {name} DES and {parent} SEAL.',
  exportName: 'blocks',
  helpLine: 'BLK HELP',
} as const

export const EXPO = {
  title: 'Exposure',
  field: 'Run',
  placeholder: 'nt_dtsmom_v0_ts1',
  empty: 'Give EXPO a run, for example {nt_dtsmom_v0_ts1 EXPO <GO>}.',
  summaryTitle: 'Exposure and turnover of {run}',
  summaryCaption: 'Exposure and turnover of {run}: the API means',
  rows: {
    meanGross: 'Mean gross exposure',
    meanNet: 'Mean net exposure',
    meanTurnover: 'Mean turnover per session',
    annualTurnover: 'Turnover a year',
    sessions: 'Sessions',
    periods: 'Turnover periods a year',
  },
  seriesTitle: 'Per session',
  gridLabel: 'Exposure and turnover of {run} per session, {n} sessions',
  cols: { date: 'Session', gross: 'Gross', net: 'Net', turnover: 'Turnover' },
  exportName: 'exposure',
  helpLine: 'EXPO HELP',
} as const

export const SEAL = {
  title: 'Sealed results',
  field: 'Hypothesis',
  placeholder: 'rebal_v0',
  empty: 'Give SEAL a hypothesis, for example {rebal_v0 SEAL <GO>}.',
  none: '{name} has no sealed-window files: its 2022+ data was never opened.',
  filesTitle: 'Sealed files of {name}',
  filesCaption: 'Sealed files of {name}, each spent',
  filesCols: { n: 'No.', name: 'File', kind: 'Kind', label: 'Label' },
  missing: 'not served',
  open: 'Show {name}',
  fileTitle: '{name}',
  pick: 'Choose a file above, or type its number and <GO>, to show it here.',
  rows: '{n} rows; columns from the allowlist only (no price column is served).',
  rowsShown: 'The first {shown} of {n} rows are shown; 98) Export saves them all.',
  jsonNote: 'JSON with every price-like key removed by the API.',
  tableLabel: '{name}, {n} rows',
  confirmationOf: '{name} is the sealed-window confirmation of {parent}; these are {parent}\'s sealed files.',
  exportName: 'sealed',
  helpLine: 'SEAL HELP',
} as const
