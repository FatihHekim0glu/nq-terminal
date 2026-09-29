// MT's sub views (look spec 4.4, roadmap R8): 85) Family (the family line, the p scatter, the adjusted
// table, the sealed confirmations and SV3, as before) and 86) Replication. Pure, so MtScreen and its
// tests share one source of what MT offers and where the numbers start. A later slice appends 'trials'
// as 87.
export type MtView = 'family' | 'replication'

export const MT_VIEWS: readonly MtView[] = ['family', 'replication']

/** House numbering for MT's sub tab strip: 85) Family, 86) Replication, ... */
export const MT_VIEW_START = 85
