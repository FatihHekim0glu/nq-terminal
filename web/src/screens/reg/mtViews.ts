// MT's sub views (look spec 4.4, roadmap R8 and #19): 85) Family (the family line, the p scatter, the adjusted
// table, the sealed confirmations and SV3, as before), 86) Replication, 87) Effective trials (the trials' own
// correlations, SV3b) and 88) Family test (SV8: the SPA, the Reality Check and StepM). Pure, so MtScreen and its tests
// share one source of what MT offers and where the numbers start.
export type MtView = 'family' | 'replication' | 'trials' | 'spa'

export const MT_VIEWS: readonly MtView[] = ['family', 'replication', 'trials', 'spa']

/** House numbering for MT's sub tab strip: 85) Family, 86) Replication, 87) Effective trials, 88) Family test. */
export const MT_VIEW_START = 85
