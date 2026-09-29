// @vitest-environment jsdom
// U02 (polish 3) on the REG screen itself: the family the Bonf, Holm and BH q columns are adjusted over, and the
// rule that PASS/FAIL is each hypothesis's own bar, are lines a reader can see. The full board (a wide or maximised
// panel) shows both in one muted note under the registry grid; the narrow board has no room for the columns and
// says the same in its compact note, and only there (no duplicate).
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConnection } from '../../api/connection'
import { resetMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import { REG } from '../../copy/reg'
import { stubLayout } from '../../grids/testing'
import { REGISTRY } from './regFixtures'
import RegScreen from './RegScreen'
import { mountScreen, panelParams, stubApi } from './testHarness'

beforeAll(() => stubLayout(1200))
beforeEach(() => {
  resetNumbered()
  resetMessage()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetConnection()
})

function board(): HTMLElement {
  return screen.getByRole('grid', { name: /Registry board/ })
}

async function ready() {
  mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
  await waitFor(() => expect(within(board()).getAllByRole('row').filter((r) => r.closest('tbody')).length).toBe(REGISTRY.counts.rows))
}

/** REG's measured width (jsdom lays nothing out) for the main column only. */
function stubMainWidth(width: number) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.classList.contains('reg-main') ? width : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1

describe('REG full board: the verdict rule and the family line (U02)', () => {
  it('shows the verdict note and the family note once each, in a muted note under the registry grid', async () => {
    stubApi()
    await ready()
    const verdict = screen.getAllByText(REG.verdictNote)
    const family = screen.getAllByText(REG.familyNote)
    expect(verdict).toHaveLength(1)
    expect(family).toHaveLength(1)
    const note = verdict[0]!.closest('.reg-note')
    expect(note).not.toBeNull()
    expect(note).toBe(family[0]!.closest('.reg-note'))
    expect(note?.classList.contains('reg-muted')).toBe(true)
    // Under the grid, not above it.
    const grid = document.querySelector('.reg-grid')!
    expect(grid.compareDocumentPosition(note!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The compact note is for the narrow board only.
    expect(screen.queryByText(/Columns hidden here/)).toBeNull()
  })

  it('keeps the short column headers the board is found by', async () => {
    stubApi()
    await ready()
    const heads = within(board()).getAllByRole('columnheader').map((h) => h.textContent)
    for (const head of ['Bonf', 'Holm', 'BH q', 'Verdict']) expect(heads).toContain(head)
  })
})

describe('REG compact board: the same two lines, only in the compact note (U02)', () => {
  it('carries both in compactNote and renders no second copy', async () => {
    const rect = stubMainWidth(660)
    try {
      stubApi()
      await ready()
      expect(screen.getByText(REG.compactNote)).toBeTruthy()
      expect(screen.queryByText(REG.verdictNote)).toBeNull()
      expect(screen.queryByText(REG.familyNote)).toBeNull()
      expect(document.querySelector('.reg-note')).toBeNull()
      const text = document.body.textContent ?? ''
      expect(occurrences(text, REG.verdictNote)).toBe(1)
      expect(occurrences(text, REG.familyNote)).toBe(1)
    } finally {
      rect.mockRestore()
    }
  })
})
