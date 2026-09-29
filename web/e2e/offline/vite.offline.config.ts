// `vite preview` for the offline Playwright project (playwright.offline.config.ts): the normal config, the
// backend's Content-Security-Policy on every static response (the built app is tested under the production
// policy, as in e2e/vite.preview.config.ts), and a middleware that answers GET /api/* in Node from the demo
// route table (src/demo/serve.ts) instead of proxying to a backend. The demo build (`--mode demo`) answers /api
// inside the page and needs none of it: the project starts it with NQT_OFFLINE_API=off.
//
// The middleware serves this machine and this origin only: a peer that is not loopback, or a browser request
// that says it is cross-site or same-site (Sec-Fetch-Site), gets 403. A request with no Sec-Fetch-Site header
// (curl, Playwright's request fixture) is allowed, as a browser navigation ('none') is. It answers GET only,
// as the demo does (any other method is 405, see serve.ts), and the stream as server-sent events: the same
// opening the in-page demo event source plays (hello, status, the journal rows), then a heartbeat every
// DEMO_STREAM.heartbeatS seconds until the client closes. A reconnect starts the opening again with fresh ids.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import {
  answerDemoHttp, demoPeerAllowed, demoStreamOpening, heartbeatEvent, isDemoApiTarget, isDemoStreamPath, sseFrame,
} from '../../src/demo/serve.ts'
import { DEMO_STREAM } from '../../src/demo/stream.ts'
import base from '../../vite.config.ts'
import { BACKEND_CSP } from '../backendCsp.ts'

const NOT_HERE = 'the offline demo API answers this machine and this origin only'

const NO_STORE = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const

/** The peer rule lives in serve.ts (demoPeerAllowed), where serve.test.ts pins it. */
function fromThisMachine(req: IncomingMessage): boolean {
  return demoPeerAllowed(req.socket.remoteAddress, req.headers['sec-fetch-site'])
}

/** The stream, as the real backend sends it: an open response of named events, until the client goes away. */
function serveStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-accel-buffering': 'no',
  })
  let id = 0
  for (const event of demoStreamOpening()) res.write(sseFrame(event, (id += 1)))
  const heartbeat = setInterval(() => {
    res.write(sseFrame(heartbeatEvent(new Date()), (id += 1)))
  }, DEMO_STREAM.heartbeatS * 1000)
  const stop = () => clearInterval(heartbeat)
  req.on('close', stop)
  res.on('close', stop)
  res.on('error', stop)
}

/** Answers /api from the demo route table before the static server sees the request. */
function demoApi(): Plugin {
  return {
    name: 'nqt-offline-demo-api',
    configurePreviewServer(server) {
      // Not returned as a post hook: the API has to answer before the static and fallback middlewares.
      server.middlewares.use((req, res, next) => {
        const target = req.url ?? ''
        const method = req.method ?? ''
        const answer = isDemoApiTarget(target) ? answerDemoHttp(method, target) : null
        if (answer === null) {
          next()
        } else if (!fromThisMachine(req)) {
          res.writeHead(403, NO_STORE)
          res.end(JSON.stringify({ detail: NOT_HERE }))
        } else if (method === 'GET' && isDemoStreamPath(target)) {
          serveStream(req, res)
        } else {
          res.writeHead(answer.status, answer.headers)
          res.end(answer.body)
        }
      })
    },
  }
}

export default defineConfig((env) => mergeConfig(base(env), {
  plugins: process.env.NQT_OFFLINE_API === 'off' ? [] : [demoApi()],
  preview: {
    host: '127.0.0.1',
    strictPort: true,
    // Proxy nothing. vite.config.ts proxies /api to the real backend on 8765 in every mode but demo, and Vite's
    // preview falls back to server.proxy when preview.proxy is unset, so without this a path the middleware
    // passes on (/apix, /api%2Fhealth) would reach the user's backend (scripts/playwrightOffline.test.ts).
    proxy: {},
    // No cross-origin reads at all: the page and its API share one origin, and the middleware above refuses
    // browser requests that are not same-origin besides.
    cors: false,
    headers: { 'content-security-policy': BACKEND_CSP },
  },
}))
