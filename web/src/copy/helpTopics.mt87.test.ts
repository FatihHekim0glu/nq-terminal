// The MT help topic covers 87) Effective trials as well as 85) and 86): what it shows, and the GET it adds.
// helpTopics.hl.test.ts checks the topic structure; this pins the wording that R19b added.
import { describe, expect, it } from 'vitest'
import { HELP_TOPICS } from './helpTopics'

const MT = HELP_TOPICS['MT']
if (MT === undefined) throw new Error('the MT help topic is missing')

describe('the MT help topic describes 87) Effective trials', () => {
  it('lists 87) Effective trials among what it shows', () => {
    expect(MT.shows.join(' ')).toContain('87) Effective trials')
  })

  it('says it is computed in the browser and an extra view only', () => {
    const line = MT.shows.find((s) => s.startsWith('87) Effective trials'))
    expect(line).toBeDefined()
    expect(line).toContain('computed in the browser')
    expect(line).toContain('an extra view only')
  })

  it('names the per-trial GET once 87) is open, as well as the earlier ones', () => {
    expect(MT.data).toContain('/api/analytics/hypothesis/{name}')
    expect(MT.data).toContain('/api/analytics/hypothesis/{name}?cost=1')
    expect(MT.data).toContain('once 87) Effective trials is open')
  })
})
