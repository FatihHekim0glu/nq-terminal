// Copy for PLAN, the pre-registration planner (research_ux.md item 2), and for the served SV9 power table on MT. UK
// spelling, no em or en dashes. `{name}` slots are filled by fillCopy(). The wording is SV9's: best case, normal and
// independent returns, one sided. Descriptive only: the planner reads no data and no price, gives no verdict and
// never overrides a frozen pass bar.

export const PLAN = {
  title: 'Pre-registration plan',
  label: 'Pre-registration plan',
  helpLine: 'PLAN HELP',
  intro: 'Check a design against its bar before a freeze or a pull. This screen reads no data and no price: the answer comes from the numbers typed here and the registry family size.',
  inputsLabel: 'Design',
  familyLabel: 'Family and effect',
  fields: {
    periods: 'Periods a year',
    by: 'Book given as',
    size: 'Size',
    k: 'Typed family size k',
    alpha: 'Alpha',
    sharpe: 'Typed Sharpe',
    eventSd: 'Event sd',
  },
  placeholders: {
    k: '<blank: registry only>',
    sharpe: '<blank: none>',
    eventSd: '<blank: not an event design>',
  },
  periodsOptions: {
    252: '252 sessions',
    52: '52 weeks',
    12: '12 months',
    4: '4 quarters',
  },
  byOptions: {
    n: 'Observations n',
    years: 'Years',
  },
  registryFamily: 'Registry family k',
  registryUnknown: 'not readable',
  loading: 'Working out the plan.',
  failed: 'The plan could not be worked out: {detail}',
  invalidLead: 'Not asked yet:',
  book: '{n} observations at {periods} a year span {years} years, one sided, alpha {alpha}.',
  barsLabel: 'Bars at the next slot of the family',
  barsCaption: 'One sided Bonferroni and Holm bars at the next slot, by family size',
  designLabel: 'The design against each bar',
  designCaption: 'Minimum detectable annual Sharpe, power and observations needed, by bar',
  slotNote: 'A family of k tests puts the next test at slot k + 1. Its Bonferroni bar is alpha / (k + 1). Holm lies between alpha / (k + 1), when the test has the smallest p value, and alpha, when it has the largest and every other hypothesis was rejected first.',
  eventNote: 'Mean per event is in the units of the event standard deviation, over n events at the bar named in the row.',
  sourceRegistry: 'Registry {k}',
  sourceTyped: 'Typed {k}',
  summarySlot: '{source}: next slot {slot}, Bonferroni bar {bar}, minimum detectable Sharpe {mde}.',
  summaryTyped: 'Power at typed Sharpe {sharpe} is {power}.',
  summaryEvent: 'Mean per event is {mean}.',
  nominalRow: 'Single test',
  slotRow: 'Slot {slot}, {source}',
  barsCols: {
    family: 'Family size',
    slot: 'Next slot',
    bonferroni: 'Bonferroni bar',
    bonferroniZ: 'Bonferroni z',
    holmStrictest: 'Holm bar, smallest p',
    holmStrictestZ: 'Holm smallest z',
    holmLoosest: 'Holm bar, largest p',
    holmLoosestZ: 'Holm largest z',
  },
  designCols: {
    test: 'Bar',
    alpha: 'Alpha',
    z: 'z',
    mde: 'Minimum detectable Sharpe, power {target}',
    powerReference: 'Power at Sharpe {s}',
    powerTyped: 'Power at typed Sharpe',
    nReference: 'n for power {target} at {s}',
    nTyped: 'n for power {target} at typed',
    meanPerEvent: 'Mean per event',
  },
  notReachable: 'not reachable',
  malformed: 'the plan was not in the expected form',
  descriptive: 'Descriptive only: no verdict, and it never overrides a frozen pass bar.',
  problems: {
    number: '{field} must be a number.',
    whole: '{field} must be a whole number.',
    range: '{field} must be from {min} to {max}.',
  },
} as const

/** The served SV9 table on MT (PowerPanel): it replaces the browser's own computation. */
export const POWER_SERVED = {
  malformed: 'the power table was not in the expected form',
  computed: 'Served by the terminal (GET /api/analytics/power) and pinned to qa/crosscheck/p12_power.py; the browser does not compute it. Descriptive only: it never overrides a frozen pass bar and gives no verdict.',
  unavailable: 'The power table is not available, so it is not drawn: {detail}',
} as const

/** The PLAN page of HELP, for copy/helpTopics.ts (the merge step registers the mnemonic and this page together). */
export const PLAN_HELP = {
  summary: 'A pre-registration planner that says whether a design can reach its bar.',
  shows: [
    'Inputs: periods a year (252, 52, 12 or 4), the book as observations or years, a typed family size beside the registry family size, alpha, an optional typed Sharpe and an optional event standard deviation.',
    'The one sided Bonferroni and Holm bars at the next slot of the family, the minimum detectable annual Sharpe at alpha and at each bar for power 0.80, power at the reference Sharpe 0.50 and at the typed one, and the observations needed.',
    'For an event design, the detectable mean per event from the event standard deviation and n.',
  ],
  data: 'GET /api/analytics/plan. It reads no price and no result file: the inputs are query parameters and the registry family size is its one count.',
  honesty: 'Best case: normal and independent returns, one sided, annualised with the book\'s own periods (never 365). Serial correlation, fat tails and skew make the true figure larger. Descriptive only: it never overrides a frozen pass bar.',
  examples: ['{PLAN <GO>}'],
  related: ['MT', 'REG'],
} as const
