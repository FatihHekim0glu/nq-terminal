// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import QuoteHeader, { HypothesisHeader } from './QuoteHeader'
import {
  formatCompact,
  formatLevel,
  formatPercentChange,
  formatPrice,
  formatSignedChange,
  formatThousands,
  formatTreasury,
  isTreasury,
} from './QuoteHeader.format'

afterEach(cleanup)

describe('number formats (look spec 3.4, decision D5)', () => {
  it('prints levels with fixed decimals, no thousands separator and no plus', () => {
    expect(formatLevel(18432.25, 2)).toBe('18432.25')
    expect(formatLevel(4766.1, 2)).toBe('4766.10')
    expect(formatLevel(-3.5, 2)).toBe('-3.50')
  })

  it('signs changes with + or an ASCII hyphen-minus, never parentheses', () => {
    expect(formatSignedChange(42.5, 2)).toBe('+42.50')
    expect(formatSignedChange(-0.25, 2)).toBe('-0.25')
    expect(formatSignedChange(0, 2)).toBe('0.00')
    expect(formatPercentChange(0.2311, 2)).toBe('+0.23%')
    expect(formatPercentChange(-1.1, 2)).toBe('-1.10%')
  })

  it('separates thousands on volume and money, and shortens dense columns with k, M, B', () => {
    expect(formatThousands(312004)).toBe('312,004')
    expect(formatThousands(-1188839)).toBe('-1,188,839')
    expect(formatCompact(6660)).toBe('6.66k')
    expect(formatCompact(1_190_000)).toBe('1.19M')
    expect(formatCompact(4_270_000_000)).toBe('4.27B')
    expect(formatCompact(512)).toBe('512')
  })

  it('writes a missing value as -- (ASCII)', () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatLevel(v, 2)).toBe('--')
      expect(formatSignedChange(v, 2)).toBe('--')
      expect(formatThousands(v)).toBe('--')
      expect(formatTreasury(v)).toBe('--')
    }
  })

  it('prints Treasury futures in 32nds with + for a half (130-06+)', () => {
    expect(formatTreasury(130 + 6.5 / 32)).toBe('130-06+')
    expect(formatTreasury(130 + 6 / 32)).toBe('130-06')
    expect(formatTreasury(130 + 19 / 32)).toBe('130-19')
    expect(formatTreasury(110)).toBe('110-00')
    expect(formatTreasury(106 + 6.25 / 32)).toBe('106-06¼')
    expect(formatTreasury(106 + 6.75 / 32)).toBe('106-06¾')
  })

  it('knows the Treasury roots and formats their prices in 32nds, others as levels', () => {
    for (const root of ['ZT', 'ZF', 'ZN', 'ZB', 'UB', 'TY1', 'US1']) expect(isTreasury(root), root).toBe(true)
    for (const root of ['NQ', 'ES', 'CL', 'GC']) expect(isTreasury(root), root).toBe(false)
    expect(formatPrice('ZN', 130 + 6.5 / 32, 2)).toBe('130-06+')
    expect(formatPrice('NQ', 18432.25, 2)).toBe('18432.25')
  })
})

const QUOTE = {
  ticker: 'NQ1 Index',
  root: 'NQ',
  last: 18432.25,
  change: 42.5,
  changePct: 0.23,
  lastTick: 'down' as const,
  time: '2021-12-31 16:00',
  delayed: true,
  volume: 312004,
  open: 18390,
  high: 18450.75,
  low: 18371.25,
  rv22: 18.4,
  spark: [18390, 18400, 18380, 18432.25],
}

describe('QuoteHeader (look spec 4.6)', () => {
  it('is a two-line named group: ticker, arrow, last, change and % change on line 1', () => {
    render(<QuoteHeader quote={QUOTE} />)
    const group = screen.getByRole('group', { name: 'Quote for NQ1 Index' })
    const [line1, line2] = group.querySelectorAll('.quote-line')
    expect(line1?.textContent).toContain('NQ1 Index')
    expect(line1?.textContent).toContain('18432.25')
    expect(line1?.textContent).toContain('+42.50')
    expect(line1?.textContent).toContain('+0.23%')
    expect(line2?.textContent).toContain('312,004')
    expect(line2?.textContent).toContain('18.4%')
  })

  it('colours the arrow by the last tick and the price by the day change, as separate spans', () => {
    render(<QuoteHeader quote={QUOTE} />)
    const arrow = screen.getByText('↓')
    expect(arrow.className).toContain('down')
    expect(within(arrow.parentElement as HTMLElement).getByText('last tick down')).toBeTruthy()
    expect(screen.getByText('18432.25').className).toContain('up')
    expect(screen.getByText('+42.50').className).toContain('up')
  })

  it('shows the ticker in white, not amber, and amber labels with white values on line 2', () => {
    render(<QuoteHeader quote={QUOTE} />)
    expect(screen.getByText('NQ1 Index').className).toContain('quote-ticker')
    expect(screen.getByText('Vol').className).toContain('quote-label')
    expect(screen.getByText('312,004').className).toContain('quote-value')
  })

  it('flags delayed in-sample data with a d that has a text alternative', () => {
    render(<QuoteHeader quote={QUOTE} />)
    const flag = screen.getByText('d')
    expect(flag.className).toContain('quote-flag')
    expect(flag.getAttribute('title')).toBe('served, delayed, in-sample')
  })

  it('draws a 60 by 14 sparkline as a decorative image', () => {
    const { container } = render(<QuoteHeader quote={QUOTE} />)
    const svg = container.querySelector('svg.quote-spark')
    expect(svg?.getAttribute('width')).toBe('60')
    expect(svg?.getAttribute('height')).toBe('14')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('prints missing values as --', () => {
    render(<QuoteHeader quote={{ ...QUOTE, change: null, changePct: null, rv22: null, spark: [] }} />)
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(2)
  })

  it('prints a Treasury quote in 32nds', () => {
    render(<QuoteHeader quote={{ ...QUOTE, ticker: 'TY1 Comdty', root: 'ZN', last: 130 + 6.5 / 32, open: 130, high: 130.5, low: 129.75 }} />)
    expect(screen.getByText('130-06+')).toBeTruthy()
  })
})

describe('HypothesisHeader (look spec 4.6, hypothesis context)', () => {
  it('shows name, bracketed verdict, t, p and round', () => {
    render(<HypothesisHeader name="rebal_v0" verdict="FAIL" t={1.13} p={0.13} round={4} />)
    const group = screen.getByRole('group', { name: 'Quote for rebal_v0' })
    expect(group.textContent).toContain('rebal_v0')
    expect(screen.getByText('[FAIL]').className).toContain('down')
    expect(group.textContent).toContain('t 1.13')
    expect(group.textContent).toContain('p 0.13')
    expect(group.textContent).toContain('round 4')
  })
})
