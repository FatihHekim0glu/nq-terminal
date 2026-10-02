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

  it('says it is served by the backend and an extra view only', () => {
    const line = MT.shows.find((s) => s.startsWith('87) Effective trials'))
    expect(line).toBeDefined()
    expect(line).toContain('served by the backend')
    expect(line).toContain('an extra view only')
  })

  it('names the SV3 GET that carries it and no per-trial GET', () => {
    expect(MT.data).toContain('GET /api/analytics/deflated for SV3, its effective number of trials (87) Effective trials)')
    expect(MT.data).not.toContain('/api/analytics/hypothesis/{name}?cost=1')
  })
})
