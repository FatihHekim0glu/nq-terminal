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
  legendPostHoc: 'on the SV3a common daily basis (Basis A): Sharpe (ann.), Years, DSR V0.',
  noScore: 'No column is a score and there is no total: the terminal adds no pass or fail.',
  tNote: 't as each result file names it (plain, Newey-West or alpha t); DES shows its label.',
  reading: 'Reading {n} hypothesis records.',
  failed: 'Details not read for {n} rows (first {name}: {detail}); their Blocks and Break-even cells show --.',
  compactNote: 'Columns hidden here (maximise the panel to see them): years, sealed test. 98) Export saves every column.',
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
  },
  blocks: '{positive}/{total}',
  sealedItem: '[{badge}] SPENT',
  sealedNone: 'none',
  csvHead: [
    'name', 'verdict [PRE-REG]', 't [PRE-REG]', 't_label', 'holm_p [PRE-REG]', 'blocks_positive [PRE-REG]',
    'blocks_total', 'blocks_unit', 'break_even_ticks_per_side [PRE-REG]', 'sealed_confirmation [SPENT]',
    'sealed_verdict [SPENT]', 'annual_sharpe_sv3a [POST HOC]', 'years_sv3a [POST HOC]', 'dsr_v0 [POST HOC]',
  ],
  export: { csv: 'Evidence matrix as CSV', fileName: 'evidence_matrix' },
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
