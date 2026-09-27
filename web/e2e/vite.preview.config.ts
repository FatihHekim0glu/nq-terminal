// `vite preview` for E2E: the normal config, with /api proxied to the fixture backend that
// playwright.config.ts starts (NQT_E2E_API_ORIGIN), and the backend's CSP on every response so the
// built app is tested under the production policy. The user's real backend on 8765 is refused.
// Run with `--mode gallery`: it serves the gallery build (dist-gallery), which is the production
// app plus the /__gallery routes.
import { defineConfig, mergeConfig } from 'vite'
import base from '../vite.config.ts'
import { BACKEND_CSP } from './backendCsp.ts'

const origin = process.env.NQT_E2E_API_ORIGIN ?? ''
const match = /^http:\/\/127\.0\.0\.1:(\d{4,5})$/.exec(origin)
if (!match || match[1] === '8765') {
  throw new Error(`NQT_E2E_API_ORIGIN must be http://127.0.0.1:<spare port>, not the real backend; got "${origin}"`)
}

export default defineConfig((env) => mergeConfig(base(env), {
  preview: {
    host: '127.0.0.1',
    strictPort: true,
    proxy: { '/api': origin },
    headers: { 'content-security-policy': BACKEND_CSP },
  },
}))
