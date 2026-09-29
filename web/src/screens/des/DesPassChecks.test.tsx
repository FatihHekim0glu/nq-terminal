// @vitest-environment jsdom
// U15 (polish 3): DES page 2. The gating statistic sits next to each boolean check, raw values carry the headline
// unit, and an implausible magnitude is flagged. The table keeps the contract of the page it replaced (DesChecks, now
// only this page under its old name): its caption, one row per check, the reading cell text, the [PASS] and [FAIL]
// results and the pass bar below.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import DesChecks from './DesChecks'
import DesPassChecks from './DesPassChecks'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA_C3 } from './desTestData'
import { passBarText } from './desModel'
import { VOLMANAGED_SCREEN } from './robustness.fixtures'

afterEach(() => cleanup())

const WITH_SCREEN = { ...VOLMANAGED, screen: VOLMANAGED_SCREEN }

function tableOf(name: string) {
  return screen.getByRole('table', { name: fillCopy(DES.checksCaption, { name }) })
}
function rowsOf(name: string) {
  return within(tableOf(name)).getAllByRole('row').slice(1)
}
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell')

describe('DesPassChecks keeps the table contract of the page it replaced', () => {
  it('has the same caption, one row per check and the same readings and results', () => {
    render(<DesPassChecks detail={OVERNIGHT} />)
    const rows = rowsOf('overnight_v0')
    expect(rows).toHaveLength(OVERNIGHT.card.pass_checks.length)
    expect(cellsOf(rows[0]!)[2]?.textContent).toBe('t >= 2.5')
    expect(cellsOf(rows[0]!)[3]?.textContent).toBe(DES.checkPass)
  })

  it('is what DesChecks now names: the page keeps its old module name for anything that still imports it', () => {
    expect(DesChecks).toBe(DesPassChecks)
  })

  it('names the reading cell by the reading alone (the Sharpe difference stays labelled as such)', () => {
    render(<DesPassChecks detail={WITH_SCREEN} />)
    expect(screen.getByRole('cell', { name: `${DES.dsrLabel} 2tick > 0` })).toBeTruthy()
  })

  it('adds one column, the gating statistic, between the result and the recorded value', () => {
    render(<DesPassChecks detail={OVERNIGHT} />)
    const c = DES.checksColumns
    const heads = within(tableOf('overnight_v0')).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual([c.number, c.key, c.reading, c.result, DES.passChecks.statColumn, c.value])
  })

  it('keeps the threshold note, the statistic note and the pass bar in full', () => {
    render(<DesPassChecks detail={OVERNIGHT} />)
    expect(screen.getByText(DES.thresholdNote)).toBeTruthy()
    expect(screen.getByText(fillCopy(DES.passChecks.statNote, { tag: '[PRE-REG]' }))).toBeTruthy()
    expect(screen.getByText(passBarText(OVERNIGHT.spec) ?? '')).toBeTruthy()
  })

  it('says a hypothesis without checks has none, and still shows its notes', () => {
    render(<DesPassChecks detail={ZA_C3} />)
    expect(screen.getByText(DES.checksNone)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('volmanaged_v0: no boolean check reads "not recorded" without its statistic', () => {
  it('shows the alpha t, the blocks and the Sharpe difference beside the three [FAIL]', () => {
    render(<DesPassChecks detail={WITH_SCREEN} />)
    const [alpha, blocks, dsr] = rowsOf('volmanaged_v0').map(cellsOf)
    expect(alpha?.[3]?.textContent).toBe(DES.checkFail)
    expect(alpha?.[4]?.textContent).toContain('+1.18')
    expect(alpha?.[4]?.textContent).toContain(VOLMANAGED.card.t_label ?? '')
    expect(alpha?.[4]?.textContent).toContain(fillCopy(DES.passChecks.bar, { threshold: '>= 2' }))
    expect(blocks?.[4]?.textContent).toContain('2010-13 +5.96, 2014-17 -1.43, 2018-21 +3.73')
    expect(blocks?.[4]?.textContent).toContain(VOLMANAGED.des.blocks_unit ?? '')
    expect(dsr?.[4]?.textContent).toContain('-0.0061')
    expect(dsr?.[4]?.textContent).toContain(fillCopy(DES.passChecks.from, { from: 'headline.2tick.dsr' }))
  })

  it('names the source of each figure', () => {
    render(<DesPassChecks detail={WITH_SCREEN} />)
    const [alpha] = rowsOf('volmanaged_v0').map(cellsOf)
    expect(alpha?.[4]?.textContent).toContain(fillCopy(DES.passChecks.from, { from: 'card.t_stat' }))
  })

  it('says so, in the statistic column, when the screen JSON is not on the card (no other number is shown)', () => {
    render(<DesPassChecks detail={VOLMANAGED} />)
    const dsr = cellsOf(rowsOf('volmanaged_v0')[2]!)
    expect(dsr[4]?.textContent).toBe(DES.passChecks.statNone)
    expect(dsr[5]?.textContent).toBe(DES.checkNone)
  })

  it('a check with a statistic does not also say "not recorded" in the value column', () => {
    render(<DesPassChecks detail={WITH_SCREEN} />)
    for (const row of rowsOf('volmanaged_v0')) expect(cellsOf(row)[5]?.textContent).not.toBe(DES.checkNone)
  })
})

describe('rebal_v0: raw values carry the headline unit and the implausible alpha is flagged', () => {
  it('prints the per-trade measures with the unit', () => {
    render(<DesPassChecks detail={REBAL} />)
    const rows = rowsOf('rebal_v0')
    const headline = rows.find((r) => cellsOf(r)[1]?.textContent === 'headline')!
    const value = cellsOf(headline)[5]?.textContent ?? ''
    expect(value).toContain('16.45 points per trade (NQ)')
    expect(value).toContain('51.2%')
    expect(value).not.toContain('16.4524')
  })

  it('flags alpha_annual_pct, and does not flag the other figures', () => {
    render(<DesPassChecks detail={REBAL} />)
    const rows = rowsOf('rebal_v0')
    const alpha = rows.find((r) => cellsOf(r)[1]?.textContent === 'alpha')!
    const value = cellsOf(alpha)[5]!
    expect(value.textContent).toContain('25573.58 %/yr')
    expect(within(value).getAllByText(DES.passChecks.implausible)).toHaveLength(1)
    const headline = rows.find((r) => cellsOf(r)[1]?.textContent === 'headline')!
    expect(within(cellsOf(headline)[5]!).queryByText(DES.passChecks.implausible)).toBeNull()
  })

  it('shows the statistic of the cN checks beside their result', () => {
    render(<DesPassChecks detail={REBAL} />)
    const rows = rowsOf('rebal_v0')
    const stat = (key: string) => cellsOf(rows.find((r) => cellsOf(r)[1]?.textContent === key)!)[4]?.textContent ?? ''
    expect(stat('c1_mean_t')).toContain('+1.13')
    expect(stat('c4_contrast')).toContain('+1.77')
    expect(stat('c5_alpha')).toContain('+1.29')
    expect(stat('c6_valid')).toContain('129')
  })
})
