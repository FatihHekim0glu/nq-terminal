// The status line's TWS value while the IB snapshot is live (PRD DL15). Kept in its own tiny module because the status
// line is part of the first-paint shell and the rest of the IB copy loads with the LIVE screen.

export const IB_STATUS_BAR = {
  /** Replaces STATUS_BAR.twsValue ("not monitored") only while the snapshot is on, reachable and fresh. */
  twsLive: 'read-only snapshot',
} as const
