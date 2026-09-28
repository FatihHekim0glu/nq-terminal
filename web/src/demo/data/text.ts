// The demo dataset's own words: the ErrorDetail texts its refusals carry, and the labels of the bodies it
// builds itself. They stand where the backend's strings stand (a screen shows them through its normal
// copy templates), so they are data of the demo server, not screen copy; routes.test.ts holds them to the
// copy rules of src/copy (UK spelling, no dashes) all the same.

export const DEMO_DETAIL = {
  /** A contract path the dataset has no honest body for: an id, cost, window or request it did not capture. */
  notInDemo: 'not in the demo dataset',
  unknownPath: 'not a path of the API contract',
  streamOnly: 'the live stream is an event stream: the demo serves it through its own event source, not a plain GET',
} as const

export const DEMO_TEXT = {
  barsLabel: 'synthetic demo prices from a seeded generator: not market data and not served through the gate',
  catalogSource: 'the demo generator: one synthetic daily vendor series per universe root; no processed file is read',
  catalogFile: '{symbol} 1d vendor (demo generator)',
  rvBasis: 'demo filler: a seeded series on the scale of the universe table realised volatility; not computed from the demo prices',
  pairBasis: 'demo filler: a seeded series that ends at the demo universe matrix entry for the same window; not computed from prices',
  twoDayBasis: 'demo filler: seeded hourly closes that end at the universe table last close, on the side of its 1D return',
  unknownPin: 'not reproduced in the demo dataset',
} as const
