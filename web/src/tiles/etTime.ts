// New York wall-clock helpers (the paper book decides at 15:55:05 ET and orders at 15:59:30 ET).
// Intl carries the daylight-saving rules, so no offset is written here.

const NEW_YORK = 'America/New_York'
const MISSING = '--'
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^(\d{2}):(\d{2}):(\d{2})$/
const DAY_MS = 86_400_000

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: NEW_YORK,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** The New York wall time of an instant, read back as if it were UTC (for the offset). */
function wallAsUtc(ms: number): number {
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.formatToParts(ms).find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

function parseDate(date: string): [number, number, number] {
  const m = DATE.exec(date)
  const y = Number(m?.[1])
  const mo = Number(m?.[2])
  const d = Number(m?.[3])
  if (!m || mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error(`Not an ISO date: ${date}`)
  return [y, mo, d]
}

/** The instant (epoch ms) of an ET wall time on an ISO date. */
export function etEpochMs(date: string, time: string): number {
  const [y, mo, d] = parseDate(date)
  const t = TIME.exec(time)
  if (!t) throw new Error(`Not an HH:MM:SS time: ${time}`)
  const guess = Date.UTC(y, mo - 1, d, Number(t[1]), Number(t[2]), Number(t[3]))
  const first = guess - (wallAsUtc(guess) - guess)
  // A second pass settles the hour either side of a clock change.
  return guess - (wallAsUtc(first) - first)
}

/** HH:MM:SS in New York for an epoch second; `--` when missing. */
export function etClock(epochSeconds: number | null | undefined): string {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return MISSING
  const wall = new Date(wallAsUtc(epochSeconds * 1000))
  return wall.toISOString().slice(11, 19)
}

const two = (n: number) => String(n).padStart(2, '0')

/** A remaining time as HH:MM:SS, partial seconds rounded up. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return `${two(h)}:${two(m)}:${two(total % 60)}`
}

/** Calendar days from one ISO date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parseDate(from)
  const [ty, tm, td] = parseDate(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS)
}
