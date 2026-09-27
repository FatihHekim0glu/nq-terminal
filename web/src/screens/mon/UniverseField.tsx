// The red bar's `[27F]` field on MON and CORR (look spec 7.7 and 7.8): the terminal has one universe, so
// the field names it in a read-only box rather than offering a list of one (amber is for real inputs
// only, look spec 4.5). It is not a Tab stop: the panel body stays the panel's one Tab stop, so its
// scroll region stays keyboard reachable (axe scrollable-region-focusable).
export default function UniverseField({ label }: { readonly label: string }) {
  return (
    <span className="field-ro fn-universe">
      <span className="sr-only">{`${label} `}</span>
      27F
    </span>
  )
}
