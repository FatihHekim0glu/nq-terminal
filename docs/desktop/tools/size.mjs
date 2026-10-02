// Run from a folder whose node_modules points at web/node_modules. Writes size.json.
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
const rd = process.env.ROLLDOWN_ENTRY // path to rolldown/dist/index.mjs inside the web package's node_modules
const { rolldown } = await import(pathToFileURL(rd).href)
const entries = {
  'react (react + react-dom: createRoot, flushSync, createPortal)': { code: "import * as R from 'react'; export {R}; export {createRoot} from 'react-dom/client'; export {flushSync, createPortal} from 'react-dom'", ext: [] },
  'zustand (create, useStore)': { code: "export {create, useStore} from 'zustand'", ext: ['react'] },
  '@tanstack/react-query (QueryClient, Provider, useQuery, useQueries, useQueryClient)': { code: "export {QueryClient, QueryClientProvider, useQuery, useQueries, useQueryClient, keepPreviousData} from '@tanstack/react-query'", ext: ['react'] },
  'cmdk (Command; app also stubs the dialog and scorer, so this is an upper bound)': { code: "export {Command} from 'cmdk'", ext: ['react','react-dom'] },
  'dockview-react (DockviewReact, DockviewApi)': { code: "export {DockviewReact, DockviewApi} from 'dockview-react'", ext: ['react','react-dom'] },
  'uplot': { code: "export {default} from 'uplot'", ext: [] },
  'lightweight-charts (all exports, no tree-shake help)': { code: "export * from 'lightweight-charts'", ext: [] },
}
const out = {}
for (const [name, e] of Object.entries(entries)) {
  fs.writeFileSync('entry.js', e.code)
  try {
    const b = await rolldown({ input: 'entry.js', external: e.ext, logLevel: 'silent', platform: 'browser' })
    const r = await b.generate({ format: 'esm', minify: true })
    const code = r.output.filter(o => o.type === 'chunk').map(o => o.code).join('')
    out[name] = { raw: Buffer.byteLength(code), gz: gzipSync(Buffer.from(code), { level: 9 }).length }
  } catch (err) { out[name] = { error: String(err).slice(0, 200) } }
}
console.log(JSON.stringify(out, null, 1))
fs.writeFileSync('size.json', JSON.stringify(out, null, 1))
