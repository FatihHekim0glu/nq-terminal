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

/** The text inside `{... <GO>}` without the braces and the GO token, or null for other text. */
export function commandLinkLine(text: string): string | null {
  const m = /^\{\s*(.+?)\s*<GO>\s*\}$/.exec(text.trim())
  return m?.[1] ?? null
}
