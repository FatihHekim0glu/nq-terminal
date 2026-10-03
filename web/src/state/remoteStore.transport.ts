// The workspace store's one connection to the backend (03 section 10.3): GET /api/workspaces/{doc} and
// PUT /api/workspaces/{doc} with If-Match, over same-origin fetch. This is the only module under src/state that calls
// fetch or names the write method, so the source scan of the client (api/client.ts findWriteRequests) allows exactly
// this file, exactly that method. Nothing here can reach a path other than /api/workspaces/<one of seven names>.
import { CLIENT_HEADER, CLIENT_ID } from '../api/client'
import { DOC_NAMES, type DocName } from './remoteStore.keys'

export const STORE_PATH = '/api/workspaces'
const WRITE_HEADER = 'X-NQT'
/** Keepalive requests in flight share one 64 kB quota of body bytes in all browsers; stay clear of it. */
export const KEEPALIVE_LIMIT = 60_000

/** What the store answered: its status and parsed JSON body (null when it had none), or status 0 when it did not answer. */
export interface StoreReply {
  readonly status: number
  readonly body: unknown
}

export interface StoreTransport {
  read(doc: DocName): Promise<StoreReply>
  /** Writes `data` as the next version of `doc`, made from `version` (the If-Match header). */
  write(doc: DocName, version: number, data: unknown): Promise<StoreReply>
  /** The same write for the page's last moments (pagehide): it outlives the page when the body is small enough. */
  writeLast(doc: DocName, version: number, data: unknown): Promise<StoreReply>
}

type Fetcher = typeof globalThis.fetch

function urlOf(doc: DocName): string {
  if (!DOC_NAMES.includes(doc)) throw new TypeError('not one of the seven documents')
  return `${STORE_PATH}/${doc}`
}

async function send(fetcher: Fetcher, url: string, init: RequestInit): Promise<StoreReply> {
  try {
    const response = await fetcher(url, {
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      ...init,
    })
    const text = await response.text().catch(() => '')
    try {
      return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) }
    } catch {
      return { status: response.status, body: null }
    }
  } catch {
    return { status: 0, body: null }
  }
}

export function createFetchTransport(fetcher: () => Fetcher = () => globalThis.fetch.bind(globalThis)): StoreTransport {
  const headers = { Accept: 'application/json', [CLIENT_HEADER]: CLIENT_ID }
  // Bytes of keepalive bodies in flight: a request that would overflow the shared quota makes the browser throw (read as
  // 'down'), so one that does not fit goes as an ordinary fetch instead.
  let inFlight = 0
  const put = async (doc: DocName, version: number, data: unknown, last: boolean): Promise<StoreReply> => {
    const body = JSON.stringify({ data })
    const bytes = new TextEncoder().encode(body).length
    const keepalive = last && inFlight + bytes <= KEEPALIVE_LIMIT
    if (keepalive) inFlight += bytes
    try {
      return await send(fetcher(), urlOf(doc), {
        method: 'PUT',
        headers: { ...headers, [WRITE_HEADER]: '1', 'Content-Type': 'application/json', 'If-Match': String(version) },
        body,
        keepalive,
      })
    } finally {
      if (keepalive) inFlight -= bytes
    }
  }
  return {
    read: async (doc) => send(fetcher(), urlOf(doc), { method: 'GET', headers }),
    write: (doc, version, data) => put(doc, version, data, false),
    writeLast: (doc, version, data) => put(doc, version, data, true),
  }
}
