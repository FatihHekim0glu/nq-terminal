// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { galleryNameFromPath } from './path'
import { GALLERY_ENTRY_PATTERN, buildGalleryRegistry, entryNameFromFile } from './registry'
import { GalleryApp } from './GalleryApp'

afterEach(cleanup)

describe('galleryNameFromPath', () => {
  it('reads the entry name after /__gallery/', () => {
    expect(galleryNameFromPath('/__gallery/LineStack')).toBe('LineStack')
    expect(galleryNameFromPath('/__gallery/LineStack/')).toBe('LineStack')
    expect(galleryNameFromPath('/__gallery/CandleChart.volume')).toBe('CandleChart.volume')
  })

  it('gives the index for /__gallery and /__gallery/', () => {
    expect(galleryNameFromPath('/__gallery')).toBe('')
    expect(galleryNameFromPath('/__gallery/')).toBe('')
  })

  it('is null for every other path, and for names outside the allowed set', () => {
    for (const p of ['/', '/HOME', '/__galleryx', '/x/__gallery/LineStack', '/__gallery/a/b', '/__gallery/%3Cscript%3E', '/__gallery/..']) {
      expect(galleryNameFromPath(p), p).toBeNull()
    }
  })
})

describe('gallery registry', () => {
  it('names an entry after its file', () => {
    expect(entryNameFromFile('../charts/LineStack.gallery.tsx')).toBe('LineStack')
    expect(entryNameFromFile('../charts/echarts/Heatmap.corr.gallery.tsx')).toBe('Heatmap.corr')
    expect(GALLERY_ENTRY_PATTERN).toBe('../**/*.gallery.tsx')
  })

  it('refuses two files with one name', () => {
    const load = () => Promise.resolve({ default: () => null })
    expect(() => buildGalleryRegistry({ '../a/X.gallery.tsx': load, '../b/X.gallery.tsx': load })).toThrow(/X/)
  })

  it('sorts the entries by name', () => {
    const load = () => Promise.resolve({ default: () => null })
    const reg = buildGalleryRegistry({ '../b/Zeta.gallery.tsx': load, '../a/Alpha.gallery.tsx': load })
    expect([...reg.keys()]).toEqual(['Alpha', 'Zeta'])
  })
})

function Probe() {
  return <p>probe entry</p>
}

function Broken(): never {
  throw new Error('fixture failure')
}

const registry = buildGalleryRegistry({
  '../x/Probe.gallery.tsx': () => Promise.resolve({ default: Probe }),
  '../x/Broken.gallery.tsx': () => Promise.resolve({ default: Broken }),
  '../x/Missing.gallery.tsx': () => Promise.reject(new Error('chunk failed')),
})

async function settle() {
  // The module promise, the render, the fonts wait and two animation frames.
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
  }
}

describe('GalleryApp', () => {
  it('lists every entry as a link on the index page', () => {
    render(<GalleryApp name="" registry={registry} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Component gallery')
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/__gallery/Broken', '/__gallery/Missing', '/__gallery/Probe'])
  })

  it('renders one entry and marks the page ready', async () => {
    const { container } = render(<GalleryApp name="Probe" registry={registry} />)
    const main = container.querySelector('main')
    expect(main?.getAttribute('data-gallery-state')).toBe('loading')
    await settle()
    expect(screen.getByText('probe entry')).toBeTruthy()
    expect(main?.getAttribute('data-gallery-state')).toBe('ready')
    expect(main?.getAttribute('data-gallery-entry')).toBe('Probe')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Gallery: Probe')
  })

  it('says so for an unknown entry', () => {
    const { container } = render(<GalleryApp name="Nope" registry={registry} />)
    expect(screen.getByText('No gallery entry named Nope.')).toBeTruthy()
    expect(container.querySelector('main')?.getAttribute('data-gallery-state')).toBe('missing')
  })

  it('shows the error when an entry throws or its chunk fails', async () => {
    const quiet = console.error
    console.error = () => undefined
    try {
      const a = render(<GalleryApp name="Broken" registry={registry} />)
      await settle()
      expect(a.container.querySelector('main')?.getAttribute('data-gallery-state')).toBe('error')
      expect(a.container.textContent).toContain('fixture failure')
      a.unmount()
      const b = render(<GalleryApp name="Missing" registry={registry} />)
      await settle()
      expect(b.container.querySelector('main')?.getAttribute('data-gallery-state')).toBe('error')
      expect(b.container.textContent).toContain('chunk failed')
    } finally {
      console.error = quiet
    }
  })
})
