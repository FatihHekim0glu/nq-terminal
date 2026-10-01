// @vitest-environment jsdom
// SV8 on MT (ANALYTICS_CATALOG SV8): the family test over the pre-registered NQ hypotheses, labelled as a family
// test, with the SPA p-values, White's Reality Check, StepM's rejections, the member table and the excluded rows.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SPA } from '../../copy/spa'
import SpaPanel from './SpaPanel'
import { SPA_HELD, SPA_NONE, SPA_REJECTS } from './spaFixtures'
import { spaCaption } from './spaModel'
import type { SpaQueryState } from './spaTypes'

afterEach(() => cleanup())

const ready = (data = SPA_REJECTS): SpaQueryState => ({ isError: false, error: null, data })

describe('SV8 panel on MT', () => {
  it('is a labelled region that says it is a family test over pre-registered hypotheses, tagged [POST HOC]', () => {
    render(<SpaPanel query={ready()} />)
    const region = screen.getByRole('region', { name: SPA.label })
    expect(within(region).getByText(SPA.title)).toBeTruthy()
    expect(within(region).getByText('[POST HOC]')).toBeTruthy()
    expect(region.textContent).toMatch(/pre-registered/)
    expect(region.textContent).toContain(SPA_REJECTS.family_note)
  })

  it("names the test a non-studentised SPA in arch's form, not Hansen's SPA, and says whom it favours", () => {
    render(<SpaPanel query={ready()} />)
    const region = screen.getByRole('region', { name: SPA.label })
    expect(within(region).getByText(SPA.title).textContent).toMatch(/non-studentised SPA/)
    expect(region.textContent).not.toMatch(/Hansen's SPA/)
    expect(region.textContent).toContain('favours members with a large spread')
  })

  it('shows the SPA p-values, the Reality Check and the StepM line', () => {
    render(<SpaPanel query={ready()} />)
    expect(screen.getByText(/SPA p-values \(non-studentised, arch form\): consistent 0\.0034/)).toBeTruthy()
    expect(screen.getByText(/rejects overnight_v0, halloween_v0/)).toBeTruthy()
  })

  it('draws one table row per member with column headers, and marks rejections in words', () => {
    render(<SpaPanel query={ready()} />)
    const table = screen.getByRole('table', { name: spaCaption(SPA_REJECTS) })
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(Object.values(SPA.cols))
    const rows = within(table).getAllByRole('row').filter((r) => r.closest('tbody'))
    expect(rows).toHaveLength(3)
    expect(within(rows[2]!).getByRole('rowheader').textContent).toBe('halloween_v0')
    expect(rows[2]!.textContent).toContain('rejected at step 1')
  })

  it('lists the registered hypotheses outside the family, or says every one is in it', () => {
    render(<SpaPanel query={ready()} />)
    const list = screen.getByRole('list', { name: SPA.excludedHeading })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    cleanup()
    render(<SpaPanel query={ready(SPA_NONE)} />)
    expect(screen.getByText(SPA.excludedEmpty)).toBeTruthy()
    expect(screen.getByText(/rejects none/)).toBeTruthy()
  })

  it('announces loading as a status and a failure as an alert with the detail', () => {
    render(<SpaPanel query={{ isError: false, error: null, data: undefined }} />)
    expect(screen.getByRole('status').textContent).toBe(SPA.loading)
    cleanup()
    render(<SpaPanel query={{ isError: true, error: { detail: 'no price source' }, data: undefined }} />)
    expect(screen.getByRole('alert').textContent).toBe('The family test is not available: no price source')
  })
})

describe('SV8 panel on MT: the two benchmarks', () => {
  it('leads with the cash row and says what null it tests', () => {
    render(<SpaPanel query={ready()} />)
    const region = screen.getByRole('region', { name: SPA.label })
    expect(region.textContent).toContain('losses -r against cash (zero return each session)')
    expect(region.textContent).toContain(SPA_REJECTS.note)
  })

  it('draws NQ buy and hold as a second, separately labelled row with its own p-values, StepM and table', () => {
    render(<SpaPanel query={ready()} />)
    const held = screen.getByRole('group', { name: SPA.heldHeading })
    expect(within(held).getByText(SPA.heldHeading)).toBeTruthy()
    expect(within(held).getByText(SPA.heldNote)).toBeTruthy()
    expect(held.textContent).toContain('losses -r against NQ buy and hold on one contract')
    expect(within(held).getByText(/SPA p-values \(non-studentised, arch form\): consistent 0\.4898/)).toBeTruthy()
    expect(within(held).getByText(/rejects none\. No member is shown to beat NQ buy and hold on one contract/)).toBeTruthy()
    const table = within(held).getByRole('table', { name: spaCaption(SPA_HELD) })
    expect(within(table).getAllByRole('row').filter((r) => r.closest('tbody'))).toHaveLength(3)
    // the primary table is a different one, so each is reachable by its own name
    expect(screen.getByRole('table', { name: spaCaption(SPA_REJECTS) })).not.toBe(table)
  })

  it('draws no second row when the view carries none', () => {
    render(<SpaPanel query={ready(SPA_NONE)} />)
    expect(screen.queryByRole('group', { name: SPA.heldHeading })).toBeNull()
  })
})

describe('SV8 panel on MT: the effective number of members', () => {
  it('states the effective members beside the p-values, with where it was computed', () => {
    render(<SpaPanel query={ready()} />)
    const region = screen.getByRole('region', { name: SPA.label })
    expect(within(region).getByText(/^Effective number of members: 2\.\d\d by eigenvalue participation and /)).toBeTruthy()
    expect(within(region).getByText('Most correlated pair of differentials: overnight_v0 and halloween_v0, rho 0.61.')).toBeTruthy()
    expect(within(region).getByText(SPA.effective.computed)).toBeTruthy()
  })

  it('says why nothing is drawn when a member has no correlation, and keeps the rest of the panel', () => {
    const gap = { ...SPA_REJECTS, correlation: [[1, null, 0.1], [null, null, null], [0.1, null, 1]] }
    render(<SpaPanel query={ready(gap)} />)
    expect(screen.getByText('Not computed: overnight_v0 does not vary on the common index, so it has no correlation.')).toBeTruthy()
    expect(screen.getByRole('table', { name: spaCaption(SPA_REJECTS) })).toBeTruthy()
  })

  it('has a tab label for MT', () => {
    expect(SPA.tab).toBe('Family test')
  })
})
