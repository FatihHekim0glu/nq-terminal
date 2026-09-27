// Copy for the live stream state on LIVE and JRNL (TASKS 9.2). UK spelling, no em or en dashes.
// `{name}` slots are filled by fillCopy().

export const STREAM = {
  label: 'Live stream state',
  stream: 'Stream',
  modes: {
    connecting: 'connecting',
    open: 'live, server events',
    reconnecting: 'reconnecting',
    polling: 'polling every {seconds} s',
    off: 'off',
  },
  reasons: {
    unsupported: 'this browser has no server events',
    refused: 'the server refused the stream (too many open, or not this origin); a new one is tried after a wait',
    timeout: 'the reconnect is taking a while; the browser keeps trying',
    stalled: 'no event for three heartbeats, so a new stream was opened',
    dropped: 'the connection dropped; the browser resumes after the last event it saw',
    bye: 'the server ended the stream at its lifetime; the browser resumes after the last event it saw',
  },
  lastEvent: 'Last event',
  lastEventValue: '{time} ET',
  rows: 'Rows streamed',
  resumed: 'Resumed',
  resumedYes: 'yes, after the last event',
  resumedNo: 'no, sent afresh',
  note: 'Server events replace polling while the stream is open; the screen polls only while it is not.',
} as const
