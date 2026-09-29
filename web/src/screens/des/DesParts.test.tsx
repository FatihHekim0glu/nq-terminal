// @vitest-environment jsdom
// LoadError (DesParts.tsx, roadmap #7): DES migrated its fault line to PanelFault, which defaults
// refusedText to MARKET.refused for a 403. DES has its own wording for every fault, including a 403,
// so LoadError must pass the same text as both failedText and refusedText: the words never change,
// only the unified amber 403 look comes from PanelFault.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import { LoadError } from './DesParts'

afterEach(() => cleanup())

describe('DesParts LoadError: unchanged wording across every status, including 403', () => {
  it('reads exactly "The terminal could not load za_v0: sealed" on a 403', () => {
    const error = new ApiError({ kind: 'http', path: '/api/hypotheses/za_v0', status: 403, body: { detail: 'sealed' }, detail: 'sealed' })
    render(<LoadError name="za_v0" error={error} />)
    expect(screen.getByRole('alert').textContent).toBe('The terminal could not load za_v0: sealed')
  })

  it('gives the same text on a 500', () => {
    const error = new ApiError({ kind: 'http', path: '/api/hypotheses/za_v0', status: 500, body: { detail: 'sealed' }, detail: 'sealed' })
    render(<LoadError name="za_v0" error={error} />)
    expect(screen.getByRole('alert').textContent).toBe('The terminal could not load za_v0: sealed')
  })
})
