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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
