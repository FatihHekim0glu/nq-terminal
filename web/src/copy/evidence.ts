// Copy for REG's sub views (look spec 7.2, roadmap #5) and the evidence matrix (92) Evidence). UK
// spelling, no em or en dashes. `{name}` slots are filled by fillCopy().

export const REG_VIEW_COPY = {
  label: 'Registry views',
  board: 'Board',
  evidence: 'Evidence',
  costs: 'Cost survival',
  map: 'Effect map',
} as const

export const EVIDENCE = {
  label: 'Evidence matrix',
  gridLabel: 'Evidence matrix: every registry row against its recorded evidence',
  legendPreReg: 'from the result files: Verdict, t, Holm p, Blocks > 0, Break-even.',
  legendSpent: 'Sealed test, the one-shot 2022+ opening.',
  legendPostHoc:
    'on the SV3a common daily basis (Basis A): Sharpe (ann.), Years, DSR V0; computed in the browser from the served n, P and alpha/k (approximate, one sided, 80% power): MDE alpha/k, Sharpe/MDE.',
  noScore: 'No column is a score and there is no total: the terminal adds no pass or fail.',
  tNote: 't as each result file names it (plain, Newey-West or alpha t); DES shows its label.',
  reading: 'Reading {n} hypothesis records.',
  failed: 'Details not read for {n} rows (first {name}: {detail}); their Blocks and Break-even cells show --.',
  compactNote: 'Columns hidden here (maximise the panel to see them): years, sealed test, MDE alpha/k, Sharpe/MDE. 98) Export saves every column.',
  powerNote: 'Columns hidden here (maximise the panel to see them): MDE alpha/k, Sharpe/MDE. 98) Export saves every column.',
  cols: {
    name: 'Name',
    verdict: 'Verdict',
    t: 't',
    holm: 'Holm p',
    blocks: 'Blocks > 0',
    breakEven: 'Break-even',
    sealed: 'Sealed test',
    sharpe: 'Sharpe (ann.)',
    years: 'Years',
    dsr: 'DSR V0',
    mde: 'MDE alpha/k',
    ratio: 'Sharpe/MDE',
  },
  blocks: '{positive}/{total}',
  sealedItem: '[{badge}] SPENT',
  sealedNone: 'none',
  csvHead: [
    'name', 'verdict [PRE-REG]', 't [PRE-REG]', 't_label', 'holm_p [PRE-REG]', 'blocks_positive [PRE-REG]',
    'blocks_total', 'blocks_unit', 'break_even_ticks_per_side [PRE-REG]', 'sealed_confirmation [SPENT]',
    'sealed_verdict [SPENT]', 'annual_sharpe_sv3a [POST HOC]', 'years_sv3a [POST HOC]', 'dsr_v0 [POST HOC]',
    'mde_alpha_over_k [POST HOC]', 'sharpe_over_mde [POST HOC]',
  ],
  export: { csv: 'Evidence matrix as CSV', fileName: 'evidence_matrix' },
} as const

/** 94) Effect map (roadmap #5, slice 3): annual Sharpe against years for every SV3a trial, each mark the trial's
 *  registry row number on 91) Board (never a Sharpe rank: the terminal keeps no score, rank or total). */
export const EVIDENCE_MAP = {
  label: 'Effect map',
  basis: 'Basis A, SV3a common daily basis; annual Sharpe against years = n / P.',
  name: 'Annual Sharpe against track length',
  xAxis: 'Years (n / P)',
  yAxis: 'Sharpe (ann.)',
  // The slot is {sr}, not {sr0}: fillCopy fills letter-only slots.
  v0Line: 'SR0 under V0 {sr} (N {n})',
  vLine: 'SR0 under V {sr}',
  zeroLine: 'zero',
  marks: 'Marks are the registry row numbers of 91) Board in its served order.',
  glyphs: 'Triangle up: PASS. Triangle down: FAIL. Ring: CHECK, or no registry row. Hollow: overlay, not an edge.',
  scaleRule: 'The years axis is logarithmic only when the longest track is at least 10 times the shortest; here it is {scale}.',
  scaleLinear: 'linear',
  scaleLog: 'logarithmic',
  pinned: 'Beyond plus or minus {limit} a point is drawn at the axis edge with its true value: {names}.',
  offLines: 'Off the axes: {lines}.',
  unnumbered: 'Marked "-", not a row of 91) Board as it now shows: {names}.',
  kindNone: 'no registry row',
  pointOpen: 'Open {name} DES',
  loading: 'Reading the Deflated Sharpe view.',
  failed: 'The Deflated Sharpe view could not be read: {detail}',
  dsrCol: 'DSR V0',
} as const

export const COST_BOARD = {
  label: 'Cost survival',
  note: 'Each tile has its own scale: compare break-even ticks, never bar heights.',
  summary: '{name}: {n} ladders, sorted by break-even; {missing} without a ladder.',
  scale: 'own scale {min} to {max} {unit}',
  tileOpen: 'Open {name} COST',
  missing: 'No ladder ({n}): {names}.',
  failed: 'Records not read for {n} hypotheses (first {name}: {detail}); they draw no tile.',
  caption: 'Cost ladders by hypothesis',
  cols: {
    name: 'Hypothesis',
    ticks: 'Ticks per side',
    value: 'Value',
    unit: 'Unit',
    breakEven: 'Break-even',
  },
} as const
