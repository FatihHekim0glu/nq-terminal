// The Content-Security-Policy the backend sends with web/dist (terminal/backend/nq_terminal/security.py,
// CONTENT_SECURITY_POLICY). vite preview sends it too, so the E2E runs the built app under the same
// policy as production; src/api/csp.test.ts fails when the two drift apart.
export const BACKEND_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
