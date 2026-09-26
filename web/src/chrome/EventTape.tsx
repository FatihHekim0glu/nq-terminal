// Event tape (spec 4.9): three PT Mono lines over the status line, newest on top, `NNNN SRC HH:MM text`.
// The source is the gate access log, so every line is a gate read (caller, timeframe, symbol) marked
// [IS] or [SEALED]. A static list: it never scrolls or animates. Props only; EventTape.live.tsx fetches.
import { TAPE } from '../copy/chrome'
import './EventTape.css'

export const TAPE_LINES = 3

/** The fields of an OOS log entry the tape shows (a subset of the generated OosLogEntry). */
export interface TapeEntry {
  readonly line_no: number
  readonly ts_utc: string
  readonly caller: string
  readonly timeframe: string | null
  readonly symbol: string | null
  readonly is_sealed: boolean
}

export interface TapeLine {
  readonly no: string
  readonly src: string
  readonly time: string
  readonly text: string
}

const ET_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function etTime(iso: string): string {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '--:--' : ET_TIME.format(new Date(t))
}

export function tapeLine(entry: TapeEntry): TapeLine {
  const parts = [TAPE.read, entry.caller, entry.timeframe, entry.symbol, entry.is_sealed ? TAPE.sealed : TAPE.inSample]
  return {
    no: String(entry.line_no % 10_000).padStart(4, '0'),
    src: TAPE.src,
    time: etTime(entry.ts_utc),
    text: parts.filter((p): p is string => Boolean(p)).join(' '),
  }
}

export interface EventTapeProps {
  /** Log entries, oldest first (the API's page order). */
  readonly entries: readonly TapeEntry[]
  readonly state: 'loading' | 'ok' | 'error'
}

function Note({ text }: { readonly text: string }) {
  return <p className="tape-note">{text}</p>
}

export function EventTape({ entries, state }: EventTapeProps) {
  const lines = [...entries].reverse().slice(0, TAPE_LINES).map(tapeLine)
  return (
    <aside className="event-tape" aria-label={TAPE.label} data-chrome="tape">
      {state === 'error' ? <Note text={TAPE.error} /> : null}
      {state === 'loading' ? <Note text={TAPE.loading} /> : null}
      {state === 'ok' && lines.length === 0 ? <Note text={TAPE.empty} /> : null}
      {lines.length > 0 ? (
        <ol className="tape-lines">
          {lines.map((l, i) => (
            <li key={`${l.no}-${i}`}>
              {`${l.no} `}
              <span className="tape-src">{l.src}</span>
              {` ${l.time} ${l.text}`}
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  )
}
