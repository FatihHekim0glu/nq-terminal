// Copy for the dossier (roadmap #15 part 2): the evidence pack and the print dossier made from the tear
// sheet or DES. Read only by the lazy code in src/export: nothing in the shell imports this file, so the
// words stay out of the first load. UK spelling, no em or en dashes. `{name}` slots are filled by
// fillCopy() (copy/workspace.ts). Words that already exist in DES, DES_REPORT, TEAR and TEAR_SV7 are reused
// from there, not repeated here.

export const DOSSIER = {
  menuPack: 'Evidence pack (HTML)',
  unavailable: 'Evidence packs and print dossiers are made from DES and the tear sheet.',
  packSaved: 'Saved the evidence pack as {file} with {n} charts, built from the answers already on screen.',
  /** packSaved for exactly one chart and for none, so the count never reads "1 charts" or "0 charts". */
  packSavedOne: 'Saved the evidence pack as {file} with 1 chart, built from the answers already on screen.',
  packSavedNone: 'Saved the evidence pack as {file} with no charts, built from the answers already on screen.',
  failed: 'The dossier could not be made: {detail}.',
  tearMissing: 'The tear sheet of {name} is not loaded, so it is not in this dossier. Open {name} EQ first; the dossier makes no request.',
  descriptive: 'Descriptive: the terminal adds no verdict. Verdicts, pass checks and hashes are read from the research files.',
  generated: 'Made {time} ET from GET answers already in this browser; nothing was recomputed.',
  /** The server clock the last health answer carried; left out when there is none. */
  serverClock: 'Server clock {time} ET at the last status check.',
  demoNote: 'DEMO DATA: fixture captures and synthetic prices, not research results.',
  figureNote: 'Charts are images of the panel as it was on screen, in its screen colours.',
  /** One source line: the GET the answer came from. */
  sourceLine: 'GET {path}',
  titles: {
    tear: '{name}: tear sheet dossier',
    des: '{name}: hypothesis dossier',
  },
  desSubtitle: 'Hypothesis description',
  sections: {
    kpis: 'Key figures',
    interval: 'Sharpe interval',
    drawdowns: 'Deepest drawdowns',
    yearly: 'Returns by year ({unit})',
    figures: 'Charts as shown',
    sources: 'Sources',
    meta: 'Series',
  },
  cols: {
    measure: 'Measure',
    value: 'Value',
    unit: 'Unit',
    basis: 'Basis',
    tag: 'Tag',
    note: 'Note',
    sharpe: 'Sharpe',
    low: 'Low',
    high: 'High',
    z: 'z',
    peak: 'Peak',
    trough: 'Trough',
    recovery: 'Recovery',
    depth: 'Depth',
    length: 'Length',
    open: 'Open',
    year: 'Year',
  },
  /** Row names of the series block that no screen already words. */
  fields: {
    unit: 'Unit',
    periods: 'Periods per year',
    source: 'Source',
    /** The run or hypothesis the answer is for, with its frequency or cost. */
    context: '{name}, {setting}',
  },
} as const
