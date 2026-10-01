// The MT help topic covers 88) Family test as well as 85) to 87): what it shows, and the GET it adds.
import { describe, expect, it } from 'vitest'
import { HELP_TOPICS } from './helpTopics'

const MT = HELP_TOPICS['MT']
if (MT === undefined) throw new Error('the MT help topic is missing')

describe('the MT help topic describes 88) Family test', () => {
  it('lists 88) Family test among what it shows, as an extra view only', () => {
    const line = MT.shows.find((s) => s.startsWith('88) Family test'))
    expect(line).toBeDefined()
    expect(line).toContain("White's Reality Check")
    expect(line).toContain('Romano-Wolf StepM')
    expect(line).toContain('computed in the browser')
    expect(line).toContain('an extra view only')
  })

  it('names the SPA GET once 88) is open, as well as the earlier ones', () => {
    expect(MT.data).toContain('GET /api/analytics/spa once 88) Family test is open')
    expect(MT.data).toContain('once 87) Effective trials is open')
  })
})
