import { describe, expect, it } from 'vitest'
import { CHROME_WORDS } from './commands'
import { HELP_TOPICS } from './helpTopics'

const text = (code: string) => (HELP_TOPICS[code]?.shows ?? []).join(' ')

// HL indexes the help prose, so a stale sentence here would be served back as a search hit.
describe('the HELP topic describes what HL searches now', () => {
  it('says HL searches what the command word says it does, and no longer the old list', () => {
    const shows = HELP_TOPICS.HELP!.shows.join(' ')
    expect(shows).toContain('HL searches ' + CHROME_WORDS.HL!.replace(/^Search /, ''))
    expect(shows).not.toContain('HL searches the help, the hypotheses and the runs')
  })
})

describe('the MT topic covers the power table and 86) Replication', () => {
  it('mentions both views and the power table', () => {
    expect(text('MT')).toContain('85) Family')
    expect(text('MT')).toContain('86) Replication')
    expect(text('MT')).toContain('power')
    expect(text('MT')).toContain('Deflated Sharpe (SV3)')
  })

  it('names the endpoints the two views read', () => {
    const data = HELP_TOPICS.MT!.data
    expect(data).toContain('/api/multiple-testing')
    expect(data).toContain('/api/analytics/deflated')
    expect(data).toContain('/api/registry')
  })
})

describe('the EXPO topic covers the per instrument series', () => {
  it('mentions the By instrument heat map and the By sector stack', () => {
    expect(text('EXPO')).toContain('By instrument')
    expect(text('EXPO')).toContain('By sector')
  })

  it('names the endpoint that supplies the instrument sectors', () => {
    const data = HELP_TOPICS.EXPO!.data
    expect(data).toContain('/api/analytics/run/{run_id}/exposure')
    expect(data).toContain('/api/commands')
  })
})
