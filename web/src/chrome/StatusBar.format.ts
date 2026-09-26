// Pure formatting for the status bar.
import type { HealthData } from '../commands/types'
import { STATUS_BAR } from '../copy/chrome'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The calendar day before an ISO date (the fence end is exclusive), or the input when unreadable. */
export function dayBefore(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso
  const t = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(t)) return iso
  return new Date(t - 86_400_000).toISOString().slice(0, 10)
}

/** `2010-01-01..2021-12-31` from the fence `[is_start, is_end)`. */
export function dataWindowValue(fence: HealthData['fence']): string {
  return `${fence.is_start}..${dayBefore(fence.is_end)}`
}

/** `DATA 2010-01-01..2021-12-31` from the fence `[is_start, is_end)`. */
export function dataWindow(fence: HealthData['fence']): string {
  return STATUS_BAR.dataWindow.replace('{value}', dataWindowValue(fence))
}

const ET_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** The time of day in New York, `hh:mm:ss` (the status bar adds ET). */
export function etClock(now: Date): string {
  return ET_CLOCK.format(now)
}
