// The launch page's one job (03 sections 2.1 and 4.2): take the one-time code from the address fragment, take the
// fragment out of the address bar and the history, swap the code for a session cookie with one request, and go to the
// terminal. The code is read once and never stored, logged or put in a URL a server sees: it travels in a header.
//
// Everything the page touches is passed in, so the whole flow is tested without a browser.
export const REDEEM_PATH = '/api/session/redeem'
export const CODE_HEADER = 'X-NQT-Code'
export const TERMINAL_PATH = '/'
const CODE = /^[0-9a-f]{64}$/

export type Outcome =
  | { readonly kind: 'opened' }
  | { readonly kind: 'no-code' }
  | { readonly kind: 'refused'; readonly status: number }
  | { readonly kind: 'unreachable' }

export interface PageEnv {
  /** `location.hash`, with or without its '#'. */
  readonly hash: string
  /** The address without its fragment: path and query. */
  readonly address: string
  /** `history.replaceState(null, '', address)`. */
  readonly replaceAddress: (address: string) => void
  readonly request: (path: string, init: RequestInit) => Promise<{ readonly status: number }>
  /** Leave this page for the terminal without a history entry (`location.replace`). */
  readonly go: (path: string) => void
}

/** The code in a fragment, or null when it is not 64 lowercase hex characters. */
export function codeFromHash(hash: string): string | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash
  return CODE.test(text) ? text : null
}

export async function redeem(env: PageEnv): Promise<Outcome> {
  const code = codeFromHash(env.hash)
  // The fragment goes first, whatever follows: a failed request must not leave a code in the history.
  if (env.hash !== '') env.replaceAddress(env.address)
  if (code === null) return { kind: 'no-code' }
  let answer: { readonly status: number }
  try {
    answer = await env.request(REDEEM_PATH, {
      method: 'GET',
      headers: { [CODE_HEADER]: code },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    })
  } catch {
    return { kind: 'unreachable' }
  }
  if (answer.status !== 200) return { kind: 'refused', status: answer.status }
  env.go(TERMINAL_PATH)
  return { kind: 'opened' }
}
