// `vite preview` for the real-data smoke run (terminal/scripts/smoke_real.ps1): serves a private build
// (the script passes --outDir, a temporary folder, so web/dist and dist-gallery are never touched), with
// /api proxied to the second backend the script starts on a spare port against the real data root, and
// the backend's CSP on every response. The user's own backend on 8765 is refused.
import { defineConfig, mergeConfig } from 'vite'
import base from '../../vite.config.ts'
import { BACKEND_CSP } from '../backendCsp.ts'

const origin = process.env.NQT_SMOKE_API_ORIGIN ?? ''
const match = /^http:\/\/127\.0\.0\.1:(\d{4,5})$/.exec(origin)
if (!match || match[1] === '8765') {
  throw new Error(`NQT_SMOKE_API_ORIGIN must be http://127.0.0.1:<spare port>, not the user's backend; got "${origin}"`)
}

export default defineConfig((env) => mergeConfig(base(env), {
  preview: {
    host: '127.0.0.1',
    strictPort: true,
    proxy: { '/api': origin },
    headers: { 'content-security-policy': BACKEND_CSP },
  },
}))
