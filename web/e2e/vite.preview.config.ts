// `vite preview` for E2E: the normal config, with /api proxied to the fixture backend that
// playwright.config.ts starts (NQT_E2E_API_ORIGIN), and the backend's CSP on every response so the
// built app is tested under the production policy. The user's real backend on 8765 is refused.
// Run with `--mode gallery` and `--outDir`: it serves the run's own gallery build, which is the production
// app plus the /__gallery routes.
import { Agent } from 'node:http'
import { defineConfig, mergeConfig } from 'vite'
import base from '../vite.config.ts'
import { BACKEND_CSP } from './backendCsp.ts'

// The proxy's own connections to the backend are kept alive (improvement run 3). Without an agent the
// proxy sends `Connection: close` and opens a new loopback socket for every API request: about 2,600 sat
// in TIME_WAIT at the peak of a four-worker run, beside the browser's own, and one run lost a page load at
// start-up to net::ERR_NO_BUFFER_SPACE. Idle sockets close after 4 s, before
// uvicorn's 5 s keep-alive ends, so a request is never sent on a socket the backend is closing. No cap on
// sockets, so a held live stream never makes other requests wait.
const IDLE_MS = 4_000
const backendAgent = new Agent({ keepAlive: true, timeout: IDLE_MS })

const origin = process.env.NQT_E2E_API_ORIGIN ?? ''
const match = /^http:\/\/127\.0\.0\.1:(\d{4,5})$/.exec(origin)
if (!match || match[1] === '8765') {
  throw new Error(`NQT_E2E_API_ORIGIN must be http://127.0.0.1:<spare port>, not the real backend; got "${origin}"`)
}

export default defineConfig((env) => mergeConfig(base(env), {
  preview: {
    host: '127.0.0.1',
    strictPort: true,
    proxy: { '/api': { target: origin, agent: backendAgent } },
    headers: { 'content-security-policy': BACKEND_CSP },
  },
}))
