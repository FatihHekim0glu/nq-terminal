// Copy for the REG (registry board) and MT (multiple-testing) screens (UI_SPEC 7 and 10; look spec 7.2).
// UK spelling, no em or en dashes, sentence case; tags and verdict badges keep their upper case.
import { isDemoPage } from './chrome'

// U02 (polish 3): the family of the adjusted columns, and the rule that a verdict is each hypothesis's own bar.
const FAMILY_NOTE = 'Bonf, Holm and BH q are adjusted over the registry family (its size k is on MT).'
const VERDICT_NOTE = "PASS/FAIL is each hypothesis's own pre-registered bar; family-adjusted p is context and does not change it."

export const REG = {
  title: 'Registry board',
  gridLabel: 'Registry board: every registry row',
  filterLabel: 'Filter hypotheses by name',
  filterPlaceholder: '<Filter by name>',
  loading: 'Reading the registry.',
  failed: 'The registry could not be read: {detail}',
  cardsFailed: 'The hypothesis cards could not be read ({detail}): verdicts come from the registry text; rounds and re-hash status are unknown.',
  empty: 'No registry row matches the filter.',
  railLabel: 'Rounds',
  railHeading: 'Rounds',
  allRounds: 'All rounds',
  round: 'Round {n}',
  noRound: 'No round',
  railItem: '{label} ({count})',
  criteriaLabel: 'Screening criteria',
  criteriaHeading: 'Selected screening criteria',
  /**
   * Where the criteria counts come from. In the demo (src/demo/boot.tsx marks the page) nothing is read through the
   * API: the registry is a snapshot of the real file served in the page (U01), so the line names the snapshot. It
   * is read each time the block is drawn, so RegParts needs no demo branch.
   */
  get criteriaSource(): string {
    return isDemoPage() ? 'values from the demo snapshot of results/registry.csv, served in this page' : 'values read from results/registry.csv through the API'
  },
  matches: 'Matches',
  criteria: {
    rows: 'Registry rows',
    registered: 'Registered hypotheses',
    edges: 'Edge hypotheses',
    overlays: 'Risk overlays (in the family, not edges)',
    passed: 'Passed own bar',
    passedEdges: 'Edges that passed their bar',
    failed: 'Failed own bar',
    checks: 'Check rows, no own bar',
    bh: 'BH q below {alpha}',
  },
  criterionItem: '{n}) {label} {count}',
  compact: 'Registered {registered}  Pass {passed}  Fail {failed}  Check {checks}  BH q<{alpha} {bh}',
  cols: {
    name: 'Name',
    round: 'Round',
    verdict: 'Verdict',
    n: 'n',
    p: 'p',
    controlP: 'Ctrl p',
    bonferroni: 'Bonf',
    holm: 'Holm',
    bhQ: 'BH q',
    sha: 'Spec sha',
    hash: 'Hash ok',
    tag: 'Tag',
    amendments: 'Amend',
  },
  tags: { edge: 'edge', overlay: '[OVERLAY]', check: 'check' },
  amend: { ok: 'ok', bad: 'NO' },
  accept: {
    label: 'Accepted amendments',
    heading: 'Accepted amendments',
    line: 'Accepted {utc} from {source}: {n} amendments, {state}.',
    allUnchanged: 'all unchanged',
    changed: '{n} CHANGED since acceptance',
    none: 'No amendment acceptances recorded: {source}',
    cols: { file: 'File', spec: 'Amends', rows: 'Registry rows', accepted: 'Sha accepted', now: 'Sha now', unchanged: 'Unchanged' },
    yes: 'yes',
    no: 'CHANGED',
  },
  // U02: which family the adjusted columns are adjusted over, and that PASS/FAIL is each hypothesis's own bar
  // whatever the adjusted p says. The verdict note is also the title of every verdict cell; compactNote carries
  // both for the narrow board, whose column headers cannot; the full board's note is RegParts's RuleNote.
  familyNote: FAMILY_NOTE,
  verdictNote: VERDICT_NOTE,
  compactNote: `Columns hidden here (a wider panel shows them; maximising may not be enough at 200% zoom in a small window): round, control p, Bonferroni, DSR, spec sha. 98) Export saves every column, and DES shows a row's spec sha and adjusted p. ${FAMILY_NOTE} ${VERDICT_NOTE}`,
  overlayNote: '[OVERLAY]: a registered risk overlay, in the multiple-testing family, but its PASS is not an edge.',
  notesLabel: 'Verdict notes',
  noteSeparator: ': ',
  hash: { ok: 'ok', registry: 'NO: registry', rehash: 'NO: re-hash', both: 'NO: both' },
  actions: {
    openMt: 'Multiple testing (MT)',
    openDes: 'Open {name} DES',
  },
  settings: {
    hideChecks: 'Hide check rows',
    showChecks: 'Show check rows',
    clear: 'Clear filters',
  },
  export: {
    csv: 'Registry as CSV',
    fileName: 'registry_board.csv',
    done: 'Registry saved as {file}.',
    unavailable: 'This browser cannot save a file here.',
  },
  // 95) Compare (roadmap #9 phase B): up to eight hypotheses marked with Space, their served Basis A
  // screen series drawn together. `note` takes the cost as its label ('1 tick'), not a bare number.
  compare: {
    bar: 'Compare {n}',
    full: 'The basket holds 8 hypotheses at most: unmark one first.',
    clear: 'Clear the basket',
    note: '[POST HOC] Basis A: the screen series at {cost} per side, each pane in its own unit. Hypotheses you picked: descriptive only, no test and no p value.',
    paramsLabel: 'Compare parameters',
    costs: { '0': '0 ticks', '1': '1 tick', '2': '2 ticks' },
    costLabel: 'Cost per side',
    chartTitle: 'Screen series of {n} hypotheses',
    chartTitleOne: 'Screen series of 1 hypothesis',
    seriesName: '{name} ({cost})',
    unitsLabel: 'Units of the chart panes',
    unitLine: 'Pane {n} in {unit}: {names}.',
    unitJoin: ', ',
    back: 'Back to the board',
    failed: '{name}: {detail}',
  },
} as const

export const CONFIRM = {
  label: 'Sealed confirmations, own alpha, outside the family',
  heading: 'Sealed confirmations',
  note: 'Each has its own alpha and is not part of the multiple-testing family.',
  empty: 'No sealed confirmation is recorded.',
  failed: 'The sealed confirmations could not be read: {detail}',
  spent: 'SPENT',
  cols: {
    name: 'Name',
    parent: 'Tests',
    n: 'n',
    p: 'p',
    alpha: 'Own alpha',
    verdict: 'Verdict',
    sha: 'Spec sha',
    hash: 'Sha ok',
    opening: 'Opening',
    label: 'Window',
  },
  closed: 'CLOSED',
  open: 'OPEN',
  ownAlpha: 'own alpha {alpha}',
} as const

export const MT = {
  title: 'Multiple testing',
  familyLabel: 'Multiple-testing family',
  loading: 'Reading the multiple-testing family.',
  failed: 'The multiple-testing family could not be read: {detail}',
  chartName: 'Registry p-values against rank',
  chartId: 'mt-pscatter',
  gridLabel: 'Adjusted p-values by rank',
  empty: 'No registered p-value.',
  family: 'Family k {k}, alpha {alpha}.',
  stored: 'Stored adjusted values match the recomputation (max abs diff {diff}).',
  storedDiffer: 'Stored adjusted values DIFFER from the recomputation (max abs diff {diff}).',
  linesOk: 'Boundary lines match the API at every rank.',
  linesDiffer: 'Boundary lines DIFFER from the API (max abs diff {diff}, first at {name}).',
  storedTag: 'PRE-REG',
  storedTagNote: 'adjusted values stored in the registry',
  computedTag: 'POST HOC',
  computedTagNote: 'recomputed by the terminal as a check; boundaries alpha/k, alpha/(k-i+1) and i alpha/k',
  cols: {
    rank: 'Rank',
    name: 'Name',
    p: 'p',
    bonferroniLine: 'Bonf line',
    holmLine: 'Holm line',
    bhLine: 'BH line',
    bonferroni: 'Bonf',
    holm: 'Holm',
    bhQ: 'BH q',
    passes: 'Under line',
    tag: 'Tag',
  },
  confirmItem: 'opening {opening}, p {p}, n {n}, {alpha}',
  // The sub tab strip (85 onwards); the later tabs name themselves in their own copy modules.
  views: { label: 'Multiple-testing views', family: 'Family' },
  actions: { openReg: 'Registry board (REG)' },
  settings: { log: 'Log p axis', linear: 'Linear p axis' },
} as const
