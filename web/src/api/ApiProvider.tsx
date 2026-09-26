import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { createApiQueryClient } from './queries'

export interface ApiProviderProps {
  readonly children: ReactNode
  /** Tests pass their own client; the app lets the provider create one per mount. */
  readonly client?: QueryClient
}

/** Wrap the app once (main.tsx) so every panel shares one query cache. */
export function ApiProvider({ children, client }: ApiProviderProps) {
  const [own] = useState(() => client ?? createApiQueryClient())
  return <QueryClientProvider client={own}>{children}</QueryClientProvider>
}
