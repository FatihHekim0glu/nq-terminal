// MT's sub views: 85) Family, 86) Replication, 87) Effective trials and 88) Family test, numbered from 85 (look spec 4.4).
import { describe, expect, it } from 'vitest'
import { MT_VIEWS, MT_VIEW_START } from './mtViews'

describe('mtViews', () => {
  it('lists family, replication, trials then spa, numbered from 85', () => {
    expect(MT_VIEWS).toEqual(['family', 'replication', 'trials', 'spa'])
    expect(MT_VIEW_START).toBe(85)
  })

  it('stays clear of the red bar numbers 96 to 99 for every view it may grow to', () => {
    expect(MT_VIEW_START + MT_VIEWS.length - 1).toBeLessThan(95)
  })
})
