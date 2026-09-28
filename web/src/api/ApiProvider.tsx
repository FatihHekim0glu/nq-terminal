import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { installConnectionSupervisor } from './connection'
import { createApiQueryClient } from './queries'

export interface ApiProviderProps {
  readonly children: ReactNode
  /** Tests pass their own client; the app lets the provider create one per mount. */
  readonly client?: QueryClient
  /** Installs the connection supervisor (health backoff, offline pausing, recovery retry). Defaults to
   *  false; tests never pass it, so a health failure in a test never pauses another test's queries. */
  readonly supervise?: boolean
}

/** Wrap the app once (main.tsx) so every panel shares one query cache. */
export function ApiProvider({ children, client, supervise = false }: ApiProviderProps) {
  const [own] = useState(() => client ?? createApiQueryClient())
  useEffect(() => {
    if (!supervise) return undefined
    return installConnectionSupervisor(own)
  }, [own, supervise])
  return <QueryClientProvider client={own}>{children}</QueryClientProvider>
}
