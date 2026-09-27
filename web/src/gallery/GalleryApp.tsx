// The component gallery (TASKS Phase 5): /__gallery lists the entries and /__gallery/<name> renders
// one component with fixture data, for screenshots and axe. It exists only in gallery builds (see
// boot.tsx and main.tsx); the production bundle has none of it (scripts/bundleCheck.ts proves it).
//
// <main data-gallery-state> tells the Playwright helper (e2e/gallery.ts) where the page is:
// loading, ready (entry rendered, fonts loaded, two frames painted), missing or error. A chart that
// loads its library lazily keeps aria-busy="true" until it has drawn; the helper waits for that too.
import { Component, Suspense, lazy, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { GALLERY } from '../copy/gallery'
import { fillCopy } from '../copy/workspace'
import { galleryHref } from './path'
import type { GalleryLoader, GalleryRegistry } from './registry'
import './gallery.css'

export type GalleryState = 'loading' | 'ready' | 'missing' | 'error'

export interface GalleryAppProps {
  /** '' for the index, else the entry name from the URL. */
  readonly name: string
  readonly registry: GalleryRegistry
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface BoundaryProps {
  readonly name: string
  readonly onError: (message: string) => void
  readonly children: ReactNode
}

class EntryBoundary extends Component<BoundaryProps, { readonly message: string | null }> {
  state = { message: null as string | null }

  static getDerivedStateFromError(err: unknown) {
    return { message: errorText(err) }
  }

  componentDidCatch(err: unknown) {
    this.props.onError(errorText(err))
  }

  render() {
    const { message } = this.state
    if (message === null) return this.props.children
    return <p className="gallery-error" role="alert">{fillCopy(GALLERY.failed, { name: this.props.name, error: message })}</p>
  }
}

/** Calls onReady once fonts are loaded and two frames have painted after the entry mounted. */
function ReadySignal({ onReady }: { readonly onReady: () => void }) {
  useEffect(() => {
    let cancelled = false
    const fonts = typeof document !== 'undefined' && 'fonts' in document ? document.fonts.ready : Promise.resolve()
    void fonts.then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!cancelled) onReady()
      }))
    })
    return () => {
      cancelled = true
    }
  }, [onReady])
  return null
}

function GalleryIndex({ registry }: { readonly registry: GalleryRegistry }) {
  const names = [...registry.keys()]
  return (
    <main className="nqt-gallery nqt-gallery-index" data-gallery-state="ready">
      <h1>{GALLERY.title}</h1>
      {names.length === 0 ? (
        <p>{GALLERY.empty}</p>
      ) : (
        <nav aria-label={GALLERY.listLabel}>
          <ul>
            {names.map((n) => (
              <li key={n}><a href={galleryHref(n)}>{n}</a></li>
            ))}
          </ul>
        </nav>
      )}
    </main>
  )
}

function GalleryEntry({ name, load }: { readonly name: string; readonly load: GalleryLoader }) {
  const [state, setState] = useState<GalleryState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  // One lazy component per entry; a failed chunk becomes the error state, not a blank page.
  const Entry = useMemo(
    () =>
      lazy(async (): Promise<{ default: ComponentType }> => {
        try {
          return await load()
        } catch (err: unknown) {
          const message = errorText(err)
          setLoadError(message)
          setState('error')
          return { default: () => null }
        }
      }),
    [load],
  )
  const markReady = useMemo(() => () => setState((s) => (s === 'loading' ? 'ready' : s)), [])
  const markError = useMemo(() => () => setState('error'), [])
  return (
    <main className="nqt-gallery" data-gallery-state={state} data-gallery-entry={name} aria-busy={state === 'loading'}>
      <h1 className="sr-only">{fillCopy(GALLERY.entryTitle, { name })}</h1>
      {loadError !== null ? (
        <p className="gallery-error" role="alert">{fillCopy(GALLERY.failed, { name, error: loadError })}</p>
      ) : (
        <EntryBoundary name={name} onError={markError}>
          <Suspense fallback={<p className="gallery-loading">{fillCopy(GALLERY.loading, { name })}</p>}>
            <Entry />
            <ReadySignal onReady={markReady} />
          </Suspense>
        </EntryBoundary>
      )}
    </main>
  )
}

export function GalleryApp({ name, registry }: GalleryAppProps) {
  if (name === '') return <GalleryIndex registry={registry} />
  const load = registry.get(name)
  if (load === undefined) {
    return (
      <main className="nqt-gallery" data-gallery-state="missing">
        <h1>{GALLERY.title}</h1>
        <p role="alert">{fillCopy(GALLERY.missing, { name })}</p>
        <p><a href={galleryHref('')}>{GALLERY.back}</a></p>
      </main>
    )
  }
  return <GalleryEntry key={name} name={name} load={load} />
}
