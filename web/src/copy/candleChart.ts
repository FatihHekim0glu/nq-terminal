// Copy for CandleChart (TASKS 5.2; look spec 6 and 7.6): the legend, the crosshair readout, event
// markers and data tips, the fence label, the accessible summary and the table view. UK spelling,
// no em or en dashes. `{name}` slots are filled by fillCopy().

export const CANDLE = {
  /** Legend rows (look spec 6.1): "<name> - Last price" and so on; the hyphen is a plain one. */
  legendName: '{name} - {field}',
  lastPrice: 'Last price',
  highOn: 'High on {date}',
  average: 'Average',
  lowOn: 'Low on {date}',
  volume: 'Volume',
  /** Crosshair readout labels: T O H L C V (UI_SPEC section 7, GP). */
  readoutTime: 'T',
  readoutOpen: 'O',
  readoutHigh: 'H',
  readoutLow: 'L',
  readoutClose: 'C',
  readoutVolume: 'V',
  /** How much of the data the zoom shows; announced with the readout after + and -. */
  shown: '{shown} of {count} bars shown',
  /** Fill markers on the price pane: an arrow plus this letter, so colour is not the only cue. */
  markerBuy: 'B',
  markerSell: 'S',
  buy: 'buy',
  sell: 'sell',
  fillEvent: 'Fill: {side} {qty} at {price}',
  rollEvent: 'Roll, gap {gap} pts ({pct})',
  rollEventPoints: 'Roll, gap {gap} pts',
  rollEventBare: 'Roll',
  /** The fence label is drawn either side of the line: "IS | 2022+ SPENT" (UI_SPEC section 6). */
  fenceBefore: 'IS',
  fenceAfter: '2022+ SPENT',
  summary: '{name}: {count} {step} bars from {start} to {end}; last close {last}; low {low} on {lowAt}, high {high} on {highAt}.',
  summaryEvents: ' {fills} and {rolls} marked.',
  summaryFence: ' The 2022-01-01 fence follows the last bar.',
  empty: '{name}: no bars.',
  fillOne: '{n} fill',
  fillMany: '{n} fills',
  rollOne: '{n} roll',
  rollMany: '{n} rolls',
  stepDaily: 'daily',
  stepHour: '{n}-hour',
  stepMinute: '{n}-minute',
  tableCaption: '{name} bars',
  colTime: 'Time',
  colOpen: 'Open',
  colHigh: 'High',
  colLow: 'Low',
  colClose: 'Close',
  colVolume: 'Volume',
  colEvents: 'Events',
  loading: 'Loading the chart library.',
  failed: 'The chart library failed to load: {error}',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
} as const

/** Gallery entries for CandleChart (gallery builds only). */
export const CANDLE_GALLERY = {
  dailyName: 'NQ1 Index',
  dailyTitle: 'NQ1 Index daily candles, 2021, link group A',
  intradayTitle: 'NQ1 Index 5-minute and 1-hour candles, link group A',
  fiveMinuteName: 'NQ1 Index 5m',
  hourName: 'NQ1 Index 1h',
  perfTitle: 'CandleChart render timing',
  perfName: 'NQ1 Index 1m',
  perfResult: '{count} bars drawn in {ms} ms',
  perfPending: 'Measuring.',
  rv22: 'RV22',
} as const
