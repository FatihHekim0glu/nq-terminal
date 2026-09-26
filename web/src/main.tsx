import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted fonts (UI_SPEC section 3), latin subsets only: works offline, no third-party requests.
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/space-grotesk/latin-600.css'
import './theme/index.css'

import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing the #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
