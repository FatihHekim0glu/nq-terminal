// One rounding rule for fixed decimals on every screen. Number.prototype.toFixed rounds the binary
// value, so 7759147.975 (stored as 7759147.97499999962...) prints .97, while Intl.NumberFormat, which
// RUNS, RUN and LEDG use for money, rounds the shortest decimal (7759147.975) half away from zero and
// prints .98. This helper gives the Intl result without grouping, so screens that format by hand agree
// with the ones that use Intl to the last displayed place.

const formats = new Map<number, Intl.NumberFormat>()

function formatFor(decimals: number): Intl.NumberFormat {
  let format = formats.get(decimals)
  if (!format) {
    format = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false })
    formats.set(decimals, format)
  }
  return format
}

/** `value` with exactly `decimals` places, ASCII minus, no grouping; ties round half away from zero. */
export function toDecimal(value: number, decimals: number): string {
  return formatFor(decimals).format(value).replace('−', '-')
}
