// The offline E2E list (e2e/visual/screens.ts) names the run each tear sheet case opens. This ties those ids to the demo
// dataset, so a run that loses its record or its analytics fails here in seconds instead of in a 7 minute Playwright run:
// EQ-run opens smoke_2015_01 and RR-run opens nt_volmanaged_v0_fixture_m1, and neither is skipped any more.
import { describe, expect, it } from 'vitest'
import screensSource from '../../e2e/visual/screens.ts?raw'
import { answerDemo } from './routes'

const OFFLINE = screensSource.slice(screensSource.indexOf('the offline run (playwright.offline.config.ts)'))

/** The run id a case opens: the offline line when the offline section overrides it, else the line of SCREENS. */
function subjectOf(name: string): string {
  const override = new RegExp(`'${name}': '([^']+) [A-Z]+'`).exec(OFFLINE)
  const base = new RegExp(`name: '${name}', line: '([^']+) [A-Z]+'`).exec(screensSource)
  const id = override?.[1] ?? base?.[1]
  expect(id, `the run of ${name}`).toBeDefined()
  return id!
}

const status = (path: string) => answerDemo(path, new URLSearchParams()).status

describe('the tear sheet cases of the offline run open runs the demo really holds', () => {
  it.each(['EQ-run', 'RR-run'])('%s: its run has a record and analytics in the demo, and the case is not skipped', (name) => {
    const id = subjectOf(name)
    expect(status(`/api/runs/${id}`), `${id} record`).toBe(200)
    expect(status(`/api/analytics/run/${id}`), `${id} analytics`).toBe(200)
    const skips = OFFLINE.slice(OFFLINE.indexOf('const OFFLINE_SKIPS'), OFFLINE.indexOf('const OFFLINE_BASE'))
    expect(skips).not.toContain(`'${name}':`)
  })

  it('opens the run of the fixture list for EQ-run and the demo\'s own run for RR-run', () => {
    expect(subjectOf('EQ-run')).toBe('smoke_2015_01')
    expect(subjectOf('RR-run')).toBe('nt_volmanaged_v0_fixture_m1')
  })

  it('leaves no screen skipped: every offline screen either draws or is driven to a request the demo holds', () => {
    const skips = OFFLINE.slice(OFFLINE.indexOf('const OFFLINE_SKIPS'), OFFLINE.indexOf('const OFFLINE_BASE'))
    expect(skips).toMatch(/OFFLINE_SKIPS: Readonly<Record<string, string>> = \{\}/)
    expect(OFFLINE).not.toMatch(/offlineSkip: '/)
  })
})
