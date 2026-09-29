// MT's sub views: 85) Family and 86) Replication, numbered from 85 (look spec 4.4; a later slice appends 87).
import { describe, expect, it } from 'vitest'
import { MT_VIEWS, MT_VIEW_START } from './mtViews'

describe('mtViews', () => {
  it('lists family then replication, numbered from 85', () => {
    expect(MT_VIEWS).toEqual(['family', 'replication'])
    expect(MT_VIEW_START).toBe(85)
  })

  it('stays clear of the red bar numbers 96 to 99 for every view it may grow to', () => {
    expect(MT_VIEW_START + MT_VIEWS.length - 1).toBeLessThan(95)
  })
})
