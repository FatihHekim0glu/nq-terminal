// @vitest-environment jsdom
// W3: REG's learned-rows line beside the Deflated Sharpe note. 'N counts L of R registered rows' from SV3's own answer
// (L is n_trials, R adds the `unlearned` list), and on demand the rows N leaves out with the reason. The toggle is a
// native button and a roving item of the panel, so the names are reached by keyboard without a second Tab stop.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConnection } from '../../api/connection'
import { resetMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import { ROVING_ATTR, ROVING_DEFAULT_ATTR, usePanelRoving } from '../../chrome/WorkspaceFocus'
import { DEFLATED } from '../../copy/deflated'
import { fillCopy } from '../../copy/workspace'
import { stubLayout } from '../../grids/testing'
import { DEFLATED_REAL } from './deflatedFixtures'
import LearnedCount from './LearnedCount'
import RegScreen from './RegScreen'
import { ANSWERS, mountScreen, panelParams, stubApi } from './testHarness'

const C2 = 'outside convention C2 (P = 252 or 12, docs/ANALYTICS_CATALOG.md:16); needs a statistics decision (O23)'
const UNLEARNED = [
  { name: 'cotliq_v0', reason: C2 },
  { name: 'zz_new_v0', reason: 'no series source yet' },
]
const VIEW = { ...DEFLATED_REAL, unlearned: UNLEARNED }

/** A stand-in for PanelChrome's frame: the panel element with its roving handler, as RegScreen.tabStop.test.tsx. */
function Frame({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const onKeyDown = usePanelRoving(ref)
  return (
    <section ref={ref} data-testid="panel" onKeyDown={onKeyDown}>
      <div className="nqt-panel-body" role="group" aria-label="REG body" tabIndex={0} {...{ [ROVING_ATTR]: '', [ROVING_DEFAULT_ATTR]: '' }}>
        {children}
      </div>
    </section>
  )
}

/** The list the toggle controls (a hidden list has no accessible name, so it is found through aria-controls). */
function controlled(button: HTMLElement): HTMLElement {
  const list = document.getElementById(button.getAttribute('aria-controls') ?? '')
  if (!list) throw new Error('the toggle controls no element')
  return list
}

function toggle(): HTMLButtonElement {
  return screen.getByRole('button', { name: fillCopy(DEFLATED.learned.show, { n: 2 }) }) as HTMLButtonElement
}

beforeEach(() => {
  resetNumbered()
  resetMessage()
})
afterEach(() => {
  cleanup()
  resetConnection()
  vi.restoreAllMocks()
})

describe('LearnedCount', () => {
  it('says how many registered rows N counts, from n_trials and the unlearned list', () => {
    render(<LearnedCount view={VIEW} />)
    expect(screen.getByText(fillCopy(DEFLATED.learned.line, { learned: 21, registered: 23 }))).toBeTruthy()
  })

  it('keeps the names and reasons out of the page until asked, then shows each with its reason', () => {
    render(<LearnedCount view={VIEW} />)
    const list = controlled(toggle())
    expect(list.tagName).toBe('UL')
    expect(list.hidden).toBe(true)
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle())
    const shown = screen.getByRole('list', { name: DEFLATED.learned.listLabel })
    expect(within(shown).getAllByRole('listitem').map((li) => li.textContent)).toEqual([`cotliq_v0: ${C2}`, 'zz_new_v0: no series source yet'])
    const hide = screen.getByRole('button', { name: DEFLATED.learned.hide })
    expect(hide.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(hide)
    expect(controlled(toggle()).hidden).toBe(true)
  })

  it('the names are reachable by keyboard: a native button, and a roving item the panel arrows reach', async () => {
    render(<Frame><LearnedCount view={VIEW} /></Frame>)
    const body = screen.getByRole('group', { name: 'REG body' })
    body.focus()
    fireEvent.keyDown(body, { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(toggle()))
    expect(toggle().tagName).toBe('BUTTON')
    expect(toggle().type).toBe('button') // Enter and Space press a native button
    expect(toggle().hasAttribute(ROVING_ATTR)).toBe(true)
    fireEvent.click(document.activeElement as HTMLElement)
    expect(screen.getByRole('list', { name: DEFLATED.learned.listLabel }).textContent).toContain('zz_new_v0')
  })

  it('says the singular for one row left out', () => {
    render(<LearnedCount view={{ ...DEFLATED_REAL, unlearned: UNLEARNED.slice(0, 1) }} />)
    expect(screen.getByRole('button', { name: DEFLATED.learned.showOne })).toBeTruthy()
  })

  it('with every row learned it says so and offers no control', () => {
    render(<LearnedCount view={{ ...DEFLATED_REAL, unlearned: [] }} />)
    expect(screen.getByText(fillCopy(DEFLATED.learned.line, { learned: 21, registered: 21 }))).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reads an answer from a backend that serves no list as every row learned', () => {
    render(<LearnedCount view={DEFLATED_REAL} />)
    expect(screen.getByText(fillCopy(DEFLATED.learned.line, { learned: 21, registered: 21 }))).toBeTruthy()
  })
})

describe('REG shows the line beside the Deflated Sharpe note', () => {
  beforeAll(() => stubLayout(1200))

  it('in a wide panel, from the deflated answer, after the registry and the hypotheses', async () => {
    // REG's measured width (jsdom lays nothing out), as RegScreen.test.tsx: wide enough for every column.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1400, height: 600, x: 0, y: 0, top: 0, left: 0, right: 1400, bottom: 600, toJSON: () => ({}) } as DOMRect)
    const seen = stubApi({}, { '/api/analytics/deflated': { ...(ANSWERS['/api/analytics/deflated'] as object), unlearned: UNLEARNED } })
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    await screen.findByText(fillCopy(DEFLATED.learned.line, { learned: 21, registered: 23 }))
    const urls = seen.map((s) => s.url)
    const deflated = urls.indexOf('/api/analytics/deflated')
    expect(deflated).toBeGreaterThan(urls.indexOf('/api/registry'))
    expect(deflated).toBeGreaterThan(urls.indexOf('/api/hypotheses'))
    expect(urls.filter((u) => u === '/api/analytics/deflated')).toHaveLength(1)
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })
})
