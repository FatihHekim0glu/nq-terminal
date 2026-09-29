// Copy for LV6, the paper book placed on its hypothesis's SV6 cone (ANALYTICS_CATALOG section 13; ROADMAP 17
// step 1). [POST HOC], descriptive: it says where the paper path sits among resampled history and nothing else.
// UK spelling, no em or en dashes, and none of the words an alarm or a verdict would use. `{name}` slots are
// filled by fillCopy(). Apostrophes sit inside double quotes.

export const EXPECTATION = {
  title: 'Paper book against its backtest expectation',
  label: 'Paper book against its backtest expectation (SV6 cone)',
  kLine: "K = {k} USD: the starting capital of {run}, the linked Nautilus reproduction of {hypothesis} (the spec's K).",
  anchorLine: 'Paper and model cumulative P&L as a fraction of K, counted from the first paper session ({date}), on the SV6 cone of {hypothesis} at {cost} per side.',
  costNote: "Paper P&L is contracts held times the change of each contract's close, before costs; the cone is the backtest net of {cost} per side.",
  latest: 'Session {step} ({date}): paper {paper} ({paperBand}); model {model} ({modelBand}). Pointwise placement by the terminal, [POST HOC].',
  bands: {
    below5: 'below the 5th percentile',
    p5to25: 'between the 5th and 25th percentile',
    p25to50: 'between the 25th and 50th',
    p50to75: 'between the 50th and 75th',
    p75to95: 'between the 75th and 95th',
    above95: 'above the 95th percentile',
  },
  /** A value at a step where the cone has no usable percentiles, or no value: named, never guessed. */
  unplaced: 'no band at this step',
  beyond: "{n} later sessions are past the cone's horizon of {horizon} and are not drawn.",
  beyondOne: "1 later session is past the cone's horizon of {horizon} and is not drawn.",
  paper: 'Paper',
  model: "Model (rule's target)",
  coneName: '{hypothesis} SV6 cone with the paper book',
  /** The cost in ticks, as the tear sheet's cost pickers word it. */
  costOne: '{n} tick',
  costMany: '{n} ticks',
  computed: 'Computed in the browser from the served paper path, the served cone and K, and pinned to qa/crosscheck/p12_expectation.py; not a served number. Descriptive only.',
  noBook: 'No registered hypothesis is linked to journal {journal}.',
  noCost: 'The paths are not placed on the cone: {hypothesis} records no cost to read a cone at.',
  noCapital: 'The paths are not placed on the cone: {reason}.',
  noRun: 'the hypothesis lists no usable linked Nautilus run',
  noK: 'the linked run {run} serves no capital',
  unitRefused: 'The cone is in {unit}, {how}; only a summed fraction-of-K cone can take the paper path.',
  empty: 'No paper session with a value yet.',
  loading: 'Loading the expectation.',
  /** The paper tracking read failed: LV5 above already announces it, so this card says only that it needs it. */
  noTracking: 'The expectation needs the paper tracking above, which could not be read.',
  failed: 'The expectation could not be read: {detail}',
  gallery: {
    title: 'Paper book against its backtest expectation, captured fixtures',
    note: 'Captured tracking, cone and capital fixtures, not a live book.',
  },
} as const
