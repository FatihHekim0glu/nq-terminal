import { createRoot } from 'react-dom/client'

// The self-test page's entry (D7.2), built only by `vite build --mode selftest` (src/selftest/index.html). The same fonts and
// tokens as the app, so axe judges the real look. `?gesture=auto` runs the clipboard and save probes without waiting for a click.
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-700.css'
import '@fontsource/pt-mono/latin-400.css'
import '../theme/index.css'
import './selftest.css'

import SelfTestApp from './SelfTestApp'

const root = document.getElementById('root')
if (!root) throw new Error('the self-test page is missing its #root element')
const autoGesture = new URLSearchParams(window.location.search).get('gesture') === 'auto'
createRoot(root).render(<SelfTestApp autoGesture={autoGesture} />)
