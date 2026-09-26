// The E2E preview must serve the backend's CSP, so a change that only production would block (an
// inline script, a data: font, a blob: worker) fails the E2E instead of shipping.
import { describe, expect, it } from 'vitest'
import securityPy from '../../../backend/nq_terminal/security.py?raw'
import previewCspTs from '../../e2e/backendCsp.ts?raw'
import previewConfigTs from '../../e2e/vite.preview.config.ts?raw'

/** The concatenated string literals of an assignment: Python `NAME = ("a" "b")` or TS `NAME = 'a' + 'b'`. */
export function literalAfter(source: string, name: string): string | null {
  const start = source.indexOf(`${name} =`)
  if (start === -1) return null
  const tail = source.slice(start + name.length + 2)
  const end = tail.search(/\n\S/)
  const body = end === -1 ? tail : tail.slice(0, end)
  const parts = [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '')
  return parts.length > 0 ? parts.join('') : null
}

describe('E2E preview CSP (ARCHITECTURE section 9)', () => {
  it('equals the backend CONTENT_SECURITY_POLICY', () => {
    const backend = literalAfter(securityPy, 'CONTENT_SECURITY_POLICY')
    expect(backend).toContain("default-src 'self'")
    expect(literalAfter(previewCspTs, 'BACKEND_CSP')).toBe(backend)
  })

  it('is sent by the preview config', () => {
    expect(previewConfigTs).toMatch(/'content-security-policy':\s*BACKEND_CSP/)
  })

  it('born failing: a drifted copy is caught', () => {
    const drifted = previewCspTs.replace("object-src 'none'", "object-src 'self'")
    expect(literalAfter(drifted, 'BACKEND_CSP')).not.toBe(literalAfter(securityPy, 'CONTENT_SECURITY_POLICY'))
  })
})
