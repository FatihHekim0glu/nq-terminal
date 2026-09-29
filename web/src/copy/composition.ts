// Copy for the book composition figures (roadmap #13, EX1 by instrument): the view toggle, the heat and
// stack chart names, the note that every instrument value is unsigned, the sampling sentences, the
// accessible summary and the table view. UK spelling, no em or en dashes. `{name}` slots are filled by
// fillCopy().

export const COMPOSITION = {
  toggle: 'Exposure view',
  views: { totals: 'Totals', heat: 'By instrument', stack: 'By sector' },
  heatName: '{run} gross exposure by instrument',
  stackName: '{run} gross exposure by instrument, stacked and coloured by sector',
  absolute:
    'Each instrument value is its absolute notional over equity as the API sends it (EX1); the direction of a position is not in this field. Net (API) carries the direction of the whole book.',
  sampling: {
    every: 'Every session is shown.',
    week: 'Columns are the last session of each week: sampled, not averaged.',
    month: 'Columns are the last session of each month: sampled, not averaged.',
  },
  other: 'Not in the instrument index',
  gross: 'Gross (API)',
  net: 'Net (API)',
  scale: 'Brightness from black (0, not held) to {max} {unit}; hue is the sector.',
  summary: '{name}: {instruments} {instrumentWord} in {sectors} {sectorWord} over {columns} {columnWord}. {sampling}',
  instrument: 'instrument',
  instruments: 'instruments',
  sector: 'sector',
  sectors: 'sectors',
  column: 'column',
  columns: 'columns',
  colInstrument: 'Instrument',
  colSector: 'Sector',
  tableCaption: '{name}, each instrument at each shown session',
  none: 'The API sends no per-instrument exposure for this run.',
  basis: 'Basis B, notional over equity',
} as const
