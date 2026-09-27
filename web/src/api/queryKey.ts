// The react-query key of a contract GET, shared by src/api/queries.ts and the live stream hook
// (src/api/useLiveStream.ts writes streamed status under the same key the status query reads).
import type { ApiPath, RequestOf } from './types'

export type ApiQueryKey<P extends ApiPath> = readonly ['api', P, RequestOf<P> | Record<string, never>]

export function apiQueryKey<P extends ApiPath>(path: P, request?: RequestOf<P>): ApiQueryKey<P> {
  return ['api', path, request ?? {}]
}

/** P0 polled the live endpoints this often; with the stream open (P1) they poll only as a fallback. */
export const LIVE_POLL_MS = 2000
