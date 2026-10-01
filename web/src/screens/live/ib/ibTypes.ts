// Types of GET /api/ib/snapshot (ARCHITECTURE section 8, "IB snapshot"; PRD U3, DL6): the generated contract types,
// under the names the panel reads.
//
// The route is a read: the terminal opens ibapi client id 95 only when NQT_IB_READONLY=1, calls only
// reqAccountSummary, reqPositions, reqAllOpenOrders, reqExecutions and reqCurrentTime (and their cancels), and
// answers with what TWS reported. Nothing here can place, change or withdraw an instruction, so no type, field
// or function in this folder is named after one; the open instructions are called "working" in code.
import type { Schemas } from '../../../api/types'

export type IbSnapshot = Schemas['IbSnapshot']
/** ok: TWS answered. disabled: NQT_IB_READONLY is not set. unavailable: no TWS answered. refused: a guard stopped the read. */
export type IbSnapshotState = IbSnapshot['state']
export type IbSummaryRow = Schemas['IbSummaryRow']
export type IbPositionRow = Schemas['IbPosition']
/** One open instruction as TWS lists it. Shown, never acted on. */
export type IbWorkingRow = Schemas['IbWorkingRow']
export type IbExecutionRow = Schemas['IbExecution']
