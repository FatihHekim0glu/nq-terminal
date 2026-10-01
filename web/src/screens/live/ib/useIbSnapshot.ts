// The read of GET /api/ib/snapshot (ARCHITECTURE section 8). One GET through the typed client, polled gently: the
// backend owns the TWS connection (ibapi client id 95, opt-in), the browser only reads what it kept. The query key is
// the contract GET's own, so the connection supervisor retries it on recovery like every other read.
import { useApiQuery } from '../../../api/queries'
import { IB_POLL_MS } from './ibSnapshotModel'

export const useIbSnapshot = () => useApiQuery('/api/ib/snapshot', {}, { refetchInterval: IB_POLL_MS, staleTime: 0 })
