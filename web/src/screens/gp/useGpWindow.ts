// The window a GP or GIP panel asks for. GP: a range button counted back from the current end (the
// fence by default), or the two amber date fields. GIP: one session, the date field. Drafts are what
// the fields show; Enter in a field submits them. A window past the fence is kept as asked, so the
// panel shows the gate's refusal for it; the data hook never turns it into a request.
import { useState } from 'react'
import { fillCopy } from '../../copy/workspace'
import { GP_COPY as C } from '../../copy/gp'
import {
  DEFAULT_RANGE, FENCE_MS, customWindow, gipWindow, isoDate, parseIsoDate, rangeWindow,
  type DateWindow, type GpTimeframe, type RangeCode,
} from './model'

export type GpMode = 'GP' | 'GIP'

/** The last in-sample session, the GIP date when the command names none. */
export const LAST_IS_DAY = '2021-12-31'
const DAY_MS = 86_400_000

export interface GpWindowState {
  readonly window: DateWindow
  /** The pressed range button; null after a custom range and on GIP. */
  readonly range: RangeCode | null
  /** GIP: the session date; GP: null. */
  readonly date: string | null
  readonly draftStart: string
  readonly draftEnd: string
  readonly fieldError: string | null
  setDraftStart(value: string): void
  setDraftEnd(value: string): void
  submit(): void
  chooseRange(range: RangeCode): void
  /** A new bar size starts from its default range, at the same end. */
  resetFor(tf: GpTimeframe): void
  /** The window a range button would ask for now. */
  windowFor(range: RangeCode): DateWindow
}

interface State {
  readonly window: DateWindow
  readonly range: RangeCode | null
  readonly date: string | null
  readonly draftStart: string
  readonly draftEnd: string
  readonly fieldError: string | null
}

function gpState(window: DateWindow, range: RangeCode | null): State {
  return { window, range, date: null, draftStart: isoDate(window.startMs), draftEnd: isoDate(window.endMs - DAY_MS), fieldError: null }
}

function gipState(date: string): State {
  const window = gipWindow(date) ?? (gipWindow(LAST_IS_DAY) as DateWindow)
  return { window, range: null, date, draftStart: date, draftEnd: '', fieldError: null }
}

function initialState(mode: GpMode, args: { readonly date?: string }, tf: GpTimeframe): State {
  if (mode === 'GIP') return gipState(args.date && parseIsoDate(args.date) !== null ? args.date : LAST_IS_DAY)
  const range = DEFAULT_RANGE[tf]
  return gpState(rangeWindow(range), range)
}

function submitted(mode: GpMode, s: State): State {
  if (mode === 'GIP') {
    const date = s.draftStart.trim()
    return parseIsoDate(date) === null ? { ...s, fieldError: fillCopy(C.badDate, { value: date }) } : gipState(date)
  }
  const result = customWindow(s.draftStart, s.draftEnd)
  if (result.ok) return gpState(result.window, null)
  const fieldError = result.reason === 'order' ? C.startAfterEnd : fillCopy(C.badDate, { value: result.value })
  return { ...s, fieldError }
}

export function useGpWindow(mode: GpMode, args: { readonly date?: string }, tf: GpTimeframe): GpWindowState {
  const [s, set] = useState<State>(() => initialState(mode, args, tf))
  // Range buttons count back from the current end, or from the fence when that end lies past it.
  const anchor = Math.min(s.window.endMs, FENCE_MS)
  const windowFor = (range: RangeCode) => rangeWindow(range, anchor)
  return {
    ...s,
    setDraftStart: (value) => set((prev) => ({ ...prev, draftStart: value })),
    setDraftEnd: (value) => set((prev) => ({ ...prev, draftEnd: value })),
    submit: () => set((prev) => submitted(mode, prev)),
    chooseRange: (range) => set(gpState(windowFor(range), range)),
    resetFor: (next) => {
      if (mode === 'GP') set(gpState(windowFor(DEFAULT_RANGE[next]), DEFAULT_RANGE[next]))
    },
    windowFor,
  }
}
