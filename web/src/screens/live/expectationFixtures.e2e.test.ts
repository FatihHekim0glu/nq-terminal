// e2e/flows/lv6.served.json carries the two served views the LIVE toggle spec gives the page (the fixture backend's own
// paper book has no value yet). It must stay equal to the captured fixtures the unit tests read.
import { describe, expect, it } from 'vitest'
import { readText } from '../../grids/testing'
import { PAPER_EXPECTATION, PAPER_EXPECTATION_LIVE } from './expectationFixtures'

const served: unknown = JSON.parse(readText(new URL('../../../e2e/flows/lv6.served.json', import.meta.url)))

describe('e2e/flows/lv6.served.json', () => {
  it('equals the captured two-session and forty-session views', () => {
    expect(served).toEqual({ twoSessions: PAPER_EXPECTATION, fortySessions: PAPER_EXPECTATION_LIVE })
  })
})
