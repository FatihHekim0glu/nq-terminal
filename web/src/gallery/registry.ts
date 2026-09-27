// Gallery entries are found by file name: any `<Name>.gallery.tsx` under src/ whose default export
// is a component that renders one component with fixture data. Each builder adds its own files next
// to its components (src/charts/LineStack.gallery.tsx is the entry /__gallery/LineStack). The glob is
// lazy, so each entry is its own chunk, and this module is reached only from the gallery build.
import type { ComponentType } from 'react'

export const GALLERY_ENTRY_PATTERN = '../**/*.gallery.tsx'

export interface GalleryEntryModule {
  readonly default: ComponentType
}

export type GalleryLoader = () => Promise<GalleryEntryModule>
export type GalleryRegistry = ReadonlyMap<string, GalleryLoader>

const SUFFIX = '.gallery.tsx'

export function entryNameFromFile(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1)
  return base.endsWith(SUFFIX) ? base.slice(0, -SUFFIX.length) : base
}

export function buildGalleryRegistry(modules: Readonly<Record<string, GalleryLoader>>): GalleryRegistry {
  const byName = new Map<string, GalleryLoader>()
  const files = new Map<string, string>()
  for (const [file, load] of Object.entries(modules)) {
    const name = entryNameFromFile(file)
    const clash = files.get(name)
    if (clash !== undefined) throw new Error(`Two gallery entries are named ${name}: ${clash} and ${file}`)
    files.set(name, file)
    byName.set(name, load)
  }
  return new Map([...byName.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')))
}

/** Every entry in src/ (the literal below must match GALLERY_ENTRY_PATTERN; Vite needs a literal). */
export function appGalleryRegistry(): GalleryRegistry {
  return buildGalleryRegistry(import.meta.glob<GalleryEntryModule>('../**/*.gallery.tsx'))
}
