// MT's sub views: 85) Family, 86) Replication and 87) Effective trials, numbered from 85 (look spec 4.4).
import { describe, expect, it } from 'vitest'
import { MT_VIEWS, MT_VIEW_START } from './mtViews'

describe('mtViews', () => {
  it('lists family, replication then trials, numbered from 85', () => {
    expect(MT_VIEWS).toEqual(['family', 'replication', 'trials'])
    expect(MT_VIEW_START).toBe(85)
  })

  it('stays clear of the red bar numbers 96 to 99 for every view it may grow to', () => {
    expect(MT_VIEW_START + MT_VIEWS.length - 1).toBeLessThan(95)
  })
})
