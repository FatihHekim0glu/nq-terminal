import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted fonts, latin subsets only: works offline, no third-party requests. Bergoom is vendored
// (OFL, declared in theme/index.css); Source Sans 3 is its fallback and PT Mono the fixed-grid face.
// Weights 400 and 700 only, plus italics.
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-400-italic.css'
import '@fontsource/source-sans-3/latin-700.css'
import '@fontsource/source-sans-3/latin-700-italic.css'
import '@fontsource/pt-mono/latin-400.css'
// OFL condition 2: the licence travels with every built copy of the Bergoom files.
import './assets/fonts/bergoom/LICENSE.md?url'
import './theme/index.css'

import App from './App'
import { applyStoredLook } from './theme/look'

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing the #root element')
// The stored theme goes on before the first render, so a viewer who chose amber-classic never sees the standard colours.
// (The workspace store, below, applies it again if its first read changes it.)
applyStoredLook()

function renderApp(el: HTMLElement): void {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// The workspace store (03 section 10, D3.3) loads as a chunk of its own, never from this entry's static imports, so the
// first-paint shell keeps its budget. It reads the saved workspaces, layouts and look into the localStorage cache and
// answers (never rejects) after at most 1.5 s, whether the backend has no store (404), cannot answer (503) or is not
// there. Two builds do not start it: the demo has no store, and the gallery build (the E2E run) leaves it to the specs
// that test it (they set window.__NQT_STORE__ first), because the run's ~390 tests share one backend and a store shared
// by every browser context would carry one test's layouts, theme and workspaces into the next. In a production build
// both conditions are constant and this is just the import.
const wantsStore =
  import.meta.env.MODE !== 'demo' &&
  (import.meta.env.MODE !== 'gallery' || (window as { __NQT_STORE__?: boolean }).__NQT_STORE__ === true)
const storeReady: Promise<unknown> = wantsStore
  ? import('./state/remoteStore').then((m) => m.startRemoteStore({ waitMs: 1500 }))
  : Promise.resolve()

function boot(el: HTMLElement): void {
  // The component gallery (/__gallery/<name>) exists only in gallery builds (`vite build --mode
  // gallery`, used by the E2E run). Vite replaces import.meta.env.MODE with a string literal, so in a
  // production build this condition is constant false and the gallery chunk is never emitted.
  if (import.meta.env.MODE === 'gallery') {
    import('./gallery/boot').then(
      (gallery) => gallery.bootGallery(el, () => renderApp(el)),
      (err: unknown) => {
        renderApp(el)
        throw err
      },
    )
  } else if (import.meta.env.MODE === 'demo') {
    // The demo (`pnpm demo`, `pnpm build:demo`): the terminal on fixture data answered in the browser, with no
    // backend (src/demo/boot.tsx). Folded away like the gallery in a production build. If the demo chunk fails
    // to load, nothing renders: the terminal without its demo layer would look live with no backend behind it.
    void import('./demo/boot').then((demo) => demo.bootDemo(() => renderApp(el)))
  } else {
    renderApp(el)
  }
}

void storeReady.catch(() => undefined).then(() => boot(root))
