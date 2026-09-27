// Gallery builds only (`vite build --mode gallery`): main.tsx imports this module behind
// `import.meta.env.MODE === 'gallery'`, which is the literal `false` in a production build, so the
// import, this chunk and everything it reaches are dropped (scripts/bundleCheck.ts checks it).
// A /__gallery path renders the gallery; any other path renders the terminal as usual.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiProvider } from '../api/ApiProvider'
import { GALLERY } from '../copy/gallery'
import { fillCopy } from '../copy/workspace'
import { GalleryApp } from './GalleryApp'
import { galleryNameFromPath } from './path'
import { appGalleryRegistry } from './registry'

// Canvas charts draw text once, in whatever face is loaded at that moment, so the gallery loads the
// chart and grid faces first: screenshots never catch a fallback font.
const PRELOAD_FONTS = ['400 13px "Bergoom"', '700 13px "Bergoom"', '400 15px "Bergoom"', '700 15px "Bergoom"', '400 15px "PT Mono"']

async function preloadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  await Promise.all(PRELOAD_FONTS.map((f) => document.fonts.load(f)))
}

export function bootGallery(root: HTMLElement, renderApp: () => void): void {
  const name = galleryNameFromPath(window.location.pathname)
  if (name === null) {
    renderApp()
    return
  }
  document.title = name === '' ? GALLERY.title : fillCopy(GALLERY.entryTitle, { name })
  // A font that fails to load must not block the page; it is reported as a page error, which the
  // Playwright helper (e2e/gallery.ts) fails on.
  void preloadFonts()
    .catch((err: unknown) => reportError(err))
    .then(() => renderGallery(root, name))
}

function renderGallery(root: HTMLElement, name: string): void {
  createRoot(root).render(
    <StrictMode>
      <ApiProvider>
        <GalleryApp name={name} registry={appGalleryRegistry()} />
      </ApiProvider>
    </StrictMode>,
  )
}
