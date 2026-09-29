// Requests to run a line through the command line from anywhere in the page: `{NQ1 Index GP <GO>}`
// command links in HELP and summaries (spec 5.1 item 10), and numbered items that open a function.
// The command line subscribes once; a request goes through the same parser and history as typing.

export interface LineRequest {
  readonly line: string
  readonly newPanel: boolean
}

type Listener = (request: LineRequest) => void

let listeners: ReadonlyArray<Listener> = []

export function requestLine(line: string, newPanel = false): void {
  const request: LineRequest = Object.freeze({ line, newPanel })
  for (const l of listeners) l(request)
}

/** Subscribes to line requests; returns the unsubscribe function. */
export function onLineRequest(listener: Listener): () => void {
  listeners = [...listeners, listener]
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

// What a run opened, told back to the line that asked for it (G14). A panel shows its link group's context, so a
// bare DES typed where the group holds a hypothesis opens as that hypothesis's DES while the parsed line still
// reads NQ DES. The Workspace reports the words of the panel it opened when they differ from the parsed line; the
// command line takes them right after onRun, for the message line, and forgets them. Module state on purpose:
// onRun answers only whether it ran (a typed boolean the command line shares with its tests).
let opened: string | null = null

/** The Workspace, after a run: what the opened panel is called, or null when it is the parsed line (or a load). */
export function reportOpened(line: string | null): void {
  opened = line
}

/** The command line, around onRun: what the last run reported, once. Null when nothing was reported. */
export function takeOpened(): string | null {
  const line = opened
  opened = null
  return line
}

/** The text inside `{... <GO>}` without the braces and the GO token, or null for other text. */
export function commandLinkLine(text: string): string | null {
  const m = /^\{\s*(.+?)\s*<GO>\s*\}$/.exec(text.trim())
  return m?.[1] ?? null
}
