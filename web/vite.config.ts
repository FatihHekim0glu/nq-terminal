import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// One origin in normal use (PRD DL13): uvicorn on 127.0.0.1:8765 serves web/dist at `/`.
// The dev server (start.ps1 -Dev) proxies /api to it.
const API_ORIGIN = 'http://127.0.0.1:8765'

// `vite build --mode gallery` (the E2E run) adds the component gallery at /__gallery/<name> and
// writes to dist-gallery, so it can never replace the production dist that start.ps1 serves. A
// production build has no gallery code at all (src/main.tsx; checked by scripts/bundleCheck.ts).
export const GALLERY_MODE = 'gallery'
export const GALLERY_OUT_DIR = 'dist-gallery'

// `vite --mode demo` (`pnpm demo`, on port 5174) and `vite build --mode demo` (`pnpm build:demo`) run the
// terminal on fixture data answered in the browser (src/demo), with no backend, so the demo has no /api
// proxy. It builds to dist-demo; a production build has no demo code (checked by scripts/bundleCheck.ts).
export const DEMO_MODE = 'demo'
export const DEMO_OUT_DIR = 'dist-demo'

/** Each build writes to its own folder, so neither the gallery nor the demo can replace the production dist. */
export function outDirFor(mode: string): string {
  if (mode === GALLERY_MODE) return GALLERY_OUT_DIR
  return mode === DEMO_MODE ? DEMO_OUT_DIR : 'dist'
}

// cmdk imports "@radix-ui/react-dialog" for Command.Dialog, which the terminal never renders (it uses the
// inline Command list). Because Command.Dialog hangs off the Command object, tree-shaking cannot drop it, and
// the dialog with its layer, focus and scroll-lock dependencies was about 10 kB gzip of the shell. This alias
// sends that one import to a stub that throws if it is ever rendered (src/vendor/radixDialogStub.tsx). It is
// scoped to the exact specifier: the other Radix packages cmdk uses (id, compose-refs) stay real.
// A second alias (shell diet 4) sends cmdk's "@radix-ui/react-primitive" to src/vendor/radixPrimitiveStub.tsx: cmdk reads two
// elements from it (div and input), and the real package's other fifteen elements and its Slot (the asChild mode the terminal
// never uses) were about 1 kB gzip of the shell. scripts/shellBudget.test.ts fails if the Slot's code comes back.
// scripts/bundleCheck.ts (rule 8) and scripts/shellBudget.test.ts fail if the dialog code comes back.
// (cmdk's command-score is stubbed by the cmdkScoreStub plugin below, not by an alias: an alias would match the
// hashed chunk name './chunk-NZJY6EH4.mjs' from any importer, and the plugin scopes it to cmdk's entry file.)
export const RESOLVE_ALIASES = [
  { find: /^@radix-ui\/react-dialog$/, replacement: fileURLToPath(new URL('./src/vendor/radixDialogStub.tsx', import.meta.url)) },
  { find: /^@radix-ui\/react-primitive$/, replacement: fileURLToPath(new URL('./src/vendor/radixPrimitiveStub.tsx', import.meta.url)) },
] as const

// cmdk scores every item with its own fuzzy matcher (command-score, about 0.4 kB gzip), which the terminal never
// uses: chrome/CommandLine.tsx passes shouldFilter={false}. The matcher sits in a chunk cmdk names by content hash,
// which only cmdk's entry file imports, and the entry reads one export from it (`a`, the scorer). This plugin sends
// that one import, from that one importer, to src/vendor/commandScoreStub.ts (a scorer that returns 1). cmdk's own
// command-score module (dist/command-score.mjs) and every other importer keep the real chunk. The hashed name is
// pinned by src/vendor/commandScoreStub.test.ts against the installed cmdk, so an upgrade that renames it fails
// there, and scripts/shellBudget.test.ts fails if the matcher's code is in any build.
const CMDK_SCORE_CHUNK = './chunk-NZJY6EH4.mjs'
const CMDK_ENTRY = /[\\/]node_modules[\\/](?:.*[\\/])?cmdk[\\/]dist[\\/]index\.mjs$/
const COMMAND_SCORE_STUB = fileURLToPath(new URL('./src/vendor/commandScoreStub.ts', import.meta.url))

export function cmdkScoreStub(): Plugin {
  return {
    name: 'nqt:cmdk-score-stub',
    enforce: 'pre',
    resolveId(source, importer) {
      return source === CMDK_SCORE_CHUNK && importer !== undefined && CMDK_ENTRY.test(importer) ? COMMAND_SCORE_STUB : null
    },
  }
}

// TanStack Query's query.js imports infiniteQueryBehavior (the paging code behind useInfiniteQuery) by a plain import, so it
// sits in the shell's vendor chunk (about 0.45 kB gzip) although the terminal has no infinite query. This plugin sends that
// one import, from query-core's query.js only, to src/vendor/infiniteQueryBehaviorStub.ts, which throws if a query ever asks
// for it. query-core's own infiniteQueryBehavior.js and infiniteQueryObserver.js are untouched (nothing imports them). The
// specifier and importer are pinned against the installed query-core by src/vendor/infiniteQueryBehaviorStub.test.ts, and
// scripts/shellBudget.test.ts fails if the paging code is in any build.
const QUERY_INFINITE_SPECIFIER = './infiniteQueryBehavior.js'
const QUERY_CORE_QUERY = /[\\/]node_modules[\\/](?:.*[\\/])?query-core[\\/]build[\\/]modern[\\/]query\.js$/
const INFINITE_STUB = fileURLToPath(new URL('./src/vendor/infiniteQueryBehaviorStub.ts', import.meta.url))

export function infiniteStub(): Plugin {
  return {
    name: 'nqt:infinite-query-stub',
    enforce: 'pre',
    resolveId(source, importer) {
      return source === QUERY_INFINITE_SPECIFIER && importer !== undefined && QUERY_CORE_QUERY.test(importer) ? INFINITE_STUB : null
    },
  }
}

/** Matches a file inside one of the named packages, in a flat or a pnpm node_modules. */
function nodeModule(names: string): RegExp {
  return new RegExp(String.raw`[\\/]node_modules[\\/](\.pnpm[\\/])?(${names})[@\\/+]`)
}

// One chunk per chart library, and one for the grid libraries, each reached only through dynamic
// imports (src/charts/lazy.ts; screens are lazy too), so none of them loads with the shell.
// scripts/bundleCheck.ts enforces it and the size budget.
export const LIBRARY_CHUNKS = [
  { name: 'uplot', test: nodeModule('uplot') },
  { name: 'lightweight-charts', test: nodeModule('lightweight-charts|fancy-canvas') },
  // tslib stays out: the shell's dialog helpers (cmdk) use it too, so it belongs in vendor.
  { name: 'echarts', test: nodeModule('echarts|zrender') },
  { name: 'tanstack-grid', test: nodeModule(String.raw`@tanstack[\\/+](react-table|table-core|react-virtual|virtual-core|react-store|store)`) },
  // The Perspective pivot grid (TASKS 9.1): client, viewer, datagrid plugin and their table and layout
  // elements, reached only through src/perspective/engine.ts. Its WebAssembly binaries and engine worker
  // are separate assets, fetched when a pivot view first mounts.
  { name: 'perspective', test: nodeModule('@perspective-dev|regular-table|regular-layout|pro_self_extracting_wasm') },
] as const

// Stable vendor chunks, cached across releases of the app code. Rolldown's groups take each captured
// module's dependencies with them (includeDependenciesRecursively, on by default), so React must be
// captured first: a library group ranked above it pulled React into tanstack-grid-*.js, and the shell
// then loaded that library chunk with every page. scripts/bundleCheck.test.ts checks the order.
// Vite's own preload helper wraps every import() in library code too (Perspective's viewer has some), so
// a library group would capture it and the shell, which needs the helper for its lazy screens, would
// then load that whole library chunk. It is captured first, into a tiny chunk of its own.
// The last group, vendor, takes every other node_modules file the app uses, so a library only lazy code needs would
// still be in the shell. It skips four TanStack Query files: useQueries and its QueriesObserver are called by REG and
// DES only (about 0.85 kB gzip), and useMutation and its MutationObserver by JOBS only (about 0.5 kB), so they fall out of
// the vendor group and load with those screens. The lookahead names the four files, and scripts/shellBudget.test.ts checks
// that `getQueries(){` and `mutateAsync` (their markers) are in no shell chunk.
export const PRELOAD_HELPER = /(^|[\\/\0])vite[\\/]preload-helper/
export const CHUNK_GROUPS = [
  { name: 'preload', test: PRELOAD_HELPER, priority: 50 },
  { name: 'react', test: /[\\/]node_modules[\\/](\.pnpm[\\/])?(react|react-dom|scheduler)[@\\/]/, priority: 40 },
  { name: 'dockview', test: /[\\/]node_modules[\\/](\.pnpm[\\/])?dockview(-core|-react)?[@\\/]/, priority: 20 },
  ...LIBRARY_CHUNKS.map((c) => ({ ...c, priority: 30 })),
  { name: 'vendor', test: /[\\/]node_modules[\\/](?!.*[\\/](?:queriesObserver|useQueries|mutationObserver|useMutation)\.js$)/, priority: 10 },
] as const

export default defineConfig(({ mode }) => ({
  plugins: [cmdkScoreStub(), infiniteStub(), react(), tailwindcss()],
  resolve: { alias: [...RESOLVE_ALIASES] },
  build: {
    outDir: outDirFor(mode),
    emptyOutDir: true,
    // Every browser the terminal runs in (a current Chromium, Firefox or Safari) preloads modules natively; the polyfill
    // is dead code there (about 0.25 kB gzip of the shell).
    modulePreload: { polyfill: false },
    // Never inline assets as data: URIs. The backend CSP falls back to default-src 'self' for fonts,
    // so an inlined woff2 would be blocked. Self-hosted files only.
    assetsInlineLimit: 0,
    // The tree-shaken ECharts chunk is about 610 kB raw (about 205 kB gzip) and loads only with an
    // ECharts panel; scripts/bundleCheck.ts enforces gzip budgets per chunk instead of this warning.
    chunkSizeWarningLimit: 700,
    // Vendor chunks as in CHUNK_GROUPS. The Workspace (dockview) and each built screen are lazy
    // imports, so the frame and its safety labels paint before them. Phase 5 adds one group per chart
    // library (LIBRARY_CHUNKS) that only chart components reach, lazily.
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [...CHUNK_GROUPS] },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: mode === DEMO_MODE ? undefined : { '/api': API_ORIGIN },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // Vitest stubs CSS imports to '' by default; the contrast test must read the real tokens file.
    // The panel, grid and screen style tests read their stylesheets as text (?raw) only.
    css: { include: [/src[\\/]theme[\\/]tokens\.css/, /src[\\/](chrome|grids|screens[\\/][a-z]+)[\\/][^?]+\.css\?raw$/] },
    restoreMocks: true,
    // One fork per hardware thread (32 here) ran the machine out of memory once the bundle test
    // added two real Vite builds; eight forks keep the whole suite at about the same wall time.
    maxWorkers: 8,
  },
}))
