// @vitest-environment jsdom
// SpecCard (TASKS 5.4, UI_SPEC sections 6 and 7 DES, look spec 7.3): the registration card of a
// hypothesis. Verdict and tag in brackets with colour and text, the short spec hash with its check,
// the multiple-testing values, and the pass bar verbatim behind a More toggle.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SpecCard, { shortSha, type SpecCardData } from './SpecCard'

const REBAL: SpecCardData = {
  name: 'rebal_v0', registered: true, round: 4, verdict: 'FAIL', verdict_badge: 'FAIL', verdict_note: null,
  spec: 'rebal_v0', spec_sha256: 'd594ec5fa7947687ccdc44ef459adc311224443152311b92c594f0c594180b74', spec_sha_ok: true, spec_rehash_ok: true,
  n: 129, t_stat: 1.13, t_label: 't', p: 0.13004898713256266, control_p: 0.09928297188210455,
  bonferroni_p: 1, holm_p: 1, bh_q: 0.2600979742651253, confirmations: ['rebal_v1_confirm'],
}

const PASS_BAR = 'PASS requires ALL of 1-6, on valid months, net of costs, with one NQ per trade.\n\nHeadline:\n1. Mean net_nq_1 > 0 and trade t >= 2.5.'

afterEach(() => cleanup())

function value(label: string): HTMLElement {
  const dt = screen.getByText(label, { selector: 'dt' })
  const dd = dt.nextElementSibling
  if (!(dd instanceof HTMLElement)) throw new Error(`no value for ${label}`)
  return dd
}

describe('shortSha', () => {
  it('keeps the first and last four hex digits', () => {
    expect(shortSha(REBAL.spec_sha256)).toBe('d594...0b74')
    expect(shortSha(null)).toBe('--')
  })
})

describe('SpecCard', () => {
  it('is a titled region with the card title band', () => {
    render(<SpecCard card={REBAL} />)
    const region = screen.getByRole('region', { name: 'Registration and spec: rebal_v0' })
    expect(within(region).getByRole('heading', { name: 'Registration and spec: rebal_v0' }).classList.contains('nqt-card-title')).toBe(true)
  })

  it('shows the tag and the verdict as bracketed text with their colour (never colour alone)', () => {
    render(<SpecCard card={REBAL} />)
    expect(value('Tag').textContent).toBe('[PRE-REG]')
    expect(value('Verdict').textContent).toBe('[FAIL]')
    expect(value('Verdict').querySelector('.tone-down')).not.toBeNull()
  })

  it('shows a PASS verdict in up text and an unregistered row as POST HOC', () => {
    render(<SpecCard card={{ ...REBAL, verdict_badge: 'PASS', verdict: 'PASS', registered: false }} />)
    expect(value('Verdict').querySelector('.tone-up')?.textContent).toBe('[PASS]')
    expect(value('Tag').textContent).toBe('[POST HOC]')
  })

  it('shows the short hash, and says when the hash or the re-hash does not match', () => {
    const { rerender } = render(<SpecCard card={REBAL} />)
    expect(value('Spec sha256').textContent).toBe('d594...0b74')
    expect(value('Hash check').textContent).toBe('[sha ok] re-hash ok')
    rerender(<SpecCard card={{ ...REBAL, spec_sha_ok: false, spec_rehash_ok: false }} />)
    expect(value('Hash check').textContent).toBe('[sha MISMATCH] re-hash failed')
    expect(value('Hash check').querySelector('.tone-down')).not.toBeNull()
  })

  it('prints n, t and the p values with fixed decimals, and -- where a value is missing', () => {
    render(<SpecCard card={{ ...REBAL, control_p: null }} />)
    expect(value('n').textContent).toBe('129')
    expect(value('t').textContent).toBe('1.13')
    expect(value('p').textContent).toBe('0.130')
    expect(value('Control p').textContent).toBe('--')
    expect(value('Bonferroni').textContent).toBe('1.000')
    expect(value('BH q').textContent).toBe('0.260')
    expect(value('Round').textContent).toBe('4')
    expect(value('Sealed confirmations').textContent).toBe('rebal_v1_confirm')
  })

  it('clamps the pass bar and opens it in full with More', () => {
    render(<SpecCard card={REBAL} passBar={PASS_BAR} />)
    const bar = screen.getByTestId('spec-passbar')
    expect(bar.textContent).toBe(PASS_BAR)
    expect(bar.getAttribute('data-clamped')).toBe('true')
    const more = screen.getByRole('button', { name: 'More' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(bar.getAttribute('data-clamped')).toBe('false')
    expect(screen.getByRole('button', { name: 'Less' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('has no pass bar section when none is given', () => {
    render(<SpecCard card={REBAL} />)
    expect(screen.queryByTestId('spec-passbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })
})
