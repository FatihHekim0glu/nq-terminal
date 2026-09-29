// The hand-over from DES to OOS (U07): the link 'Gate reads (OOS) for this hypothesis' asks for the OOS log on one
// caller (requestOosCaller(caller, panelId)), and the link then runs `OOS`, which replaces the screen of the panel
// the link is in. So the request belongs to that panel: only an OOS screen in the same panel takes it, either at
// once (one already open there) or on mount (the one that opens next), through useOosCallerRequest(panelId, apply).
// An OOS open in another panel never takes it. The caller is taken once and then forgotten, so a later plain `OOS`
// starts unfiltered, and a request nobody takes within OOS_CALLER_TTL_MS is dropped rather than left to surprise
// some later OOS. The OOS command takes no context (registry: none), so this is the only way a caller travels
// with it. '' is the panel id outside a workspace. Nothing is fetched here.
import { useEffect } from 'react'

/** How long a request waits for the OOS screen that will open in its panel (the command runs at once). */
export const OOS_CALLER_TTL_MS = 10_000

interface Request {
  readonly caller: string
  readonly panelId: string
  readonly at: number
}

let pending: Request | null = null
const takers = new Set<() => void>()

/** Ask for the OOS log on `caller`, for the OOS screen of panel `panelId`; a blank name asks for nothing. */
export function requestOosCaller(caller: string, panelId: string): void {
  const name = caller.trim()
  if (name === '') return
  pending = { caller: name, panelId, at: Date.now() }
  for (const take of [...takers]) take()
}

/** Forget any request and every listener (tests). */
export function resetOosCaller(): void {
  pending = null
  takers.clear()
}

/**
 * Apply a requested caller to this OOS screen (in panel `panelId`): the one waiting when it mounts, and any asked
 * for while it is open. `apply` should be stable (a state setter). A request is taken by one screen only, and
 * only by one in the panel it was asked for; a request older than OOS_CALLER_TTL_MS is dropped.
 */
export function useOosCallerRequest(panelId: string, apply: (caller: string) => void): void {
  useEffect(() => {
    const take = () => {
      if (pending === null) return
      if (Date.now() - pending.at > OOS_CALLER_TTL_MS) {
        pending = null
        return
      }
      if (pending.panelId !== panelId) return
      const caller = pending.caller
      pending = null
      apply(caller)
    }
    take()
    takers.add(take)
    return () => {
      takers.delete(take)
    }
  }, [panelId, apply])
}
