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

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing the #root element')

function renderApp(el: HTMLElement): void {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// The component gallery (/__gallery/<name>) exists only in gallery builds (`vite build --mode
// gallery`, used by the E2E run). Vite replaces import.meta.env.MODE with a string literal, so in a
// production build this condition is constant false and the gallery chunk is never emitted.
if (import.meta.env.MODE === 'gallery') {
  import('./gallery/boot').then(
    (gallery) => gallery.bootGallery(root, () => renderApp(root)),
    (err: unknown) => {
      renderApp(root)
      throw err
    },
  )
} else if (import.meta.env.MODE === 'demo') {
  // The demo (`pnpm demo`, `pnpm build:demo`): the terminal on fixture data answered in the browser, with no
  // backend (src/demo/boot.tsx). Folded away like the gallery in a production build. If the demo chunk fails
  // to load, nothing renders: the terminal without its demo layer would look live with no backend behind it.
  void import('./demo/boot').then((demo) => demo.bootDemo(() => renderApp(root)))
} else {
  renderApp(root)
}
