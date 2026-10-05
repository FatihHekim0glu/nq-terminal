// The seam between the Start from flow and the server. The flow reads presets (a GET) and launches a run (a POST); the
// only module of the web app that may send a write is api/jobsClient.ts (the GET-only source scan in api/client.ts
// allows exactly that file), so this module holds no request of its own. It names what the flow needs, and the
// default transport reads and writes through jobsClient, converting the server's shapes in wire.ts. Tests give the flow a
// transport of their own through LaunchTransportContext.
import { createContext, useContext } from 'react'
import { getPresets, postAction } from '../../api/jobsClient'
import { LAUNCH } from '../../copy/launch'
import type { JobView } from '../jobs/types'
import type { LaunchRequest, PresetsView } from './types'
import { presetsView } from './wire'

export interface CallOptions {
  readonly signal?: AbortSignal
}

export interface LaunchTransport {
  /** GET /api/jobs/actions/presets. */
  readonly presets: (options?: CallOptions) => Promise<PresetsView>
  /** POST /api/jobs/actions with a backtest body. Answers the queued job; a refusal rejects with an error that carries a `detail`. */
  readonly launch: (request: LaunchRequest, options?: CallOptions) => Promise<JobView>
}

export const SERVER_TRANSPORT: LaunchTransport = {
  presets: async (options) => presetsView(await getPresets(options)),
  launch: async (request, options) => (await postAction(request, options)).job,
}

export const LaunchTransportContext = createContext<LaunchTransport>(SERVER_TRANSPORT)

export const useLaunchTransport = (): LaunchTransport => useContext(LaunchTransportContext)

/** The words of a failure: its `detail` when it has one, else its message. */
export function failureDetail(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'detail' in error && typeof (error as { detail: unknown }).detail === 'string') return (error as { detail: string }).detail
  return error instanceof Error ? error.message : LAUNCH.failedFallback
}
