// @vitest-environment jsdom
// The /__gallery/RegEvidence entry builds its rows with the registered family, so volmanaged_v0's MDE alpha/k
// and Sharpe/MDE read 1.12 and 0.88 (the powerView figures), not -- .
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EVIDENCE } from '../../copy/evidence'
import { stubLayout } from '../../grids/testing'
import RegEvidenceGallery from './RegEvidence.gallery'

beforeAll(() => stubLayout(1200))
afterEach(cleanup)

describe('RegEvidence gallery', () => {
  it("shows volmanaged_v0's MDE alpha/k and Sharpe/MDE, not --", () => {
    render(<RegEvidenceGallery />)
    const grid = screen.getByRole('grid', { name: EVIDENCE.gridLabel })
    const rows = within(grid).getAllByRole('row').filter((r) => r.closest('tbody'))
    const vm = rows.find((r) => within(r).queryByText('volmanaged_v0') !== null)
    expect(vm).toBeDefined()
    expect(within(vm!).getByText('1.12')).toBeTruthy()
    expect(within(vm!).getByText('0.88')).toBeTruthy()
  })
})
