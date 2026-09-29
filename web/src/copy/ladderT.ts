// Copy for the recorded t under the cost-ladder and block bars (N04; DES page 3, COST, BLK). UK spelling, no em
// or en dashes. `{name}` slots are filled by fillCopy(). The t is the screen file's own; no interval is derived (C8).

export const LADDER_T = {
  /** A bar's label with its recorded t: '1 tick, t 1.18'. */
  bar: '{label}, t {t}',
  note: 't under each bar is the statistic the screen file records beside that bar. The file records no interval for the bars, so none is drawn and none is computed here.',
  /** The card's gating statistic, so the bars' t reads against the verdict. */
  gating: 'Gating: {label} {t}.',
  gatingLabel: 't',
} as const
