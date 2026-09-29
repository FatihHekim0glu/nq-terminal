// @vitest-environment jsdom
// G20: Shift+Enter on a REG row opens its DES in a new panel; a plain Enter opens it in place.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { resetMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import { stubLayout } from '../../grids/testing'
import { REGISTRY } from './regFixtures'
import RegScreen from './RegScreen'
import { mountScreen, panelParams, stubApi } from './testHarness'

beforeAll(() => stubLayout(600))
afterEach(() => {
  cleanup()
  resetNumbered()
  resetMessage()
})

async function ready(): Promise<HTMLElement> {
  stubApi()
  mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
  const grid = await screen.findByRole('grid', { name: /Registry board/ })
  await waitFor(() => expect(within(grid).getAllByRole('row').length - 1).toBe(REGISTRY.counts.rows))
  return grid
}

describe('REG: Shift+Enter opens DES in a new panel (G20)', () => {
  it('Shift+Enter on a row requests "<name> DES" with newPanel true', async () => {
    const grid = await ready()
    const lines: LineRequest[] = []
    const stop = onLineRequest((r) => lines.push(r))
    fireEvent.keyDown(grid, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(grid, { key: 'Enter' })
    stop()
    const first = within(grid).getAllByRole('row')[1]!.querySelectorAll('td')[1]!.textContent
    expect(lines).toEqual([
      { line: `${first} DES`, newPanel: true },
      { line: `${first} DES`, newPanel: false },
    ])
  })
})
