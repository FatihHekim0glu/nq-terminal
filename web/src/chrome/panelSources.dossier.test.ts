// @vitest-environment jsdom
// The dossier half of the panel source registry (roadmap 15 part 2). A panel keeps one provenance and one
// dossier closure, each latest-wins on its own, so a screen that registers only its dossier (DES on Profile)
// never shadows the provenance a child chart registers, and the other way round.
import { cleanup, render } from '@testing-library/react'
import { createElement, StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DossierInput } from '../export/dossier/types'
import type { GrabProvenance } from '../export/grab/grabModel'
import { PanelActionsContext, type PanelActions } from './PanelChrome.actions'
import { panelDossier, panelSource, registerPanelSource, resetPanelSources, usePanelSource, type PanelSource } from './panelSources'

afterEach(() => {
  cleanup()
  resetPanelSources()
})

const NONE: GrabProvenance = { tags: [], basis: null, unit: null, window: null, n: null, source: null, specSha: null }
const provenance = (unit: string): GrabProvenance => ({ ...NONE, unit })
/** A dossier closure that is never called: the registry only stores it. */
const dossier = (): (() => DossierInput | null) => () => null

function actions(panelId: string): PanelActions {
  return { panelId, related: () => false, back: () => false, forward: () => false, open: () => false }
}

function Probe({ source }: { readonly source: PanelSource | null }): ReactNode {
  usePanelSource(source)
  return null
}

function inPanel(panelId: string, source: PanelSource | null, strict = false) {
  const body = createElement(PanelActionsContext.Provider, { value: actions(panelId) }, createElement(Probe, { source }))
  return strict ? createElement(StrictMode, null, body) : body
}

describe('panelDossier', () => {
  it('answers null for a panel that registered nothing, or only a provenance', () => {
    expect(panelDossier('p1')).toBeNull()
    registerPanelSource('p1', { provenance: provenance('ticks') })
    expect(panelDossier('p1')).toBeNull()
  })

  it('returns the closure a panel registered, by panel id', () => {
    const a = dossier()
    const b = dossier()
    registerPanelSource('p1', { provenance: provenance('ticks'), dossier: a })
    registerPanelSource('p2', { provenance: null, dossier: b })
    expect(panelDossier('p1')).toBe(a)
    expect(panelDossier('p2')).toBe(b)
  })

  it('lets the latest dossier win', () => {
    const first = dossier()
    const second = dossier()
    registerPanelSource('p1', { provenance: null, dossier: first })
    registerPanelSource('p1', { provenance: null, dossier: second })
    expect(panelDossier('p1')).toBe(second)
  })

  it('is what a source carrying both a provenance and a dossier also shows through panelSource', () => {
    const source: PanelSource = { provenance: provenance('ticks'), dossier: dossier() }
    registerPanelSource('p1', source)
    expect(panelSource('p1')).toBe(source)
    expect(panelDossier('p1')).toBe(source.dossier)
  })
})

describe('a dossier-only registration (provenance null)', () => {
  it('registers no provenance: panelSource stays null, as when nothing is registered', () => {
    registerPanelSource('p1', { provenance: null, dossier: dossier() })
    expect(panelSource('p1')).toBeNull()
  })

  it('does not shadow a provenance registered before it, and is not shadowed by one registered after it', () => {
    const chart: PanelSource = { provenance: provenance('R') }
    const screenDossier = dossier()
    registerPanelSource('p1', chart)
    registerPanelSource('p1', { provenance: null, dossier: screenDossier })
    expect(panelSource('p1')).toBe(chart)
    expect(panelDossier('p1')).toBe(screenDossier)
    const later: PanelSource = { provenance: provenance('ticks') }
    registerPanelSource('p1', later)
    expect(panelSource('p1')).toBe(later)
    expect(panelDossier('p1')).toBe(screenDossier)
  })

  it('still lets a provenance-only registration replace a provenance that came with a dossier', () => {
    const screenDossier = dossier()
    registerPanelSource('p1', { provenance: provenance('ticks'), dossier: screenDossier })
    const chart: PanelSource = { provenance: provenance('R') }
    registerPanelSource('p1', chart)
    expect(panelSource('p1')).toBe(chart)
    expect(panelDossier('p1')).toBe(screenDossier)
  })

  it('removes only its own slots with its disposer', () => {
    const chart: PanelSource = { provenance: provenance('R') }
    registerPanelSource('p1', chart)
    const dispose = registerPanelSource('p1', { provenance: null, dossier: dossier() })
    dispose()
    expect(panelDossier('p1')).toBeNull()
    expect(panelSource('p1')).toBe(chart)
  })

  it('lets a disposer remove only its own dossier, never a later one', () => {
    const disposeFirst = registerPanelSource('p1', { provenance: provenance('ticks'), dossier: dossier() })
    const later = dossier()
    registerPanelSource('p1', { provenance: null, dossier: later })
    disposeFirst()
    expect(panelDossier('p1')).toBe(later)
    expect(panelSource('p1')).toBeNull()
  })

  it('does not fail when a disposer runs twice', () => {
    const dispose = registerPanelSource('p1', { provenance: null, dossier: dossier() })
    const later = dossier()
    registerPanelSource('p1', { provenance: null, dossier: later })
    dispose()
    dispose()
    expect(panelDossier('p1')).toBe(later)
  })

  it('forgets everything on reset, dossiers included', () => {
    registerPanelSource('p1', { provenance: null, dossier: dossier() })
    resetPanelSources()
    expect(panelDossier('p1')).toBeNull()
  })
})

describe('usePanelSource with a dossier', () => {
  it('registers a dossier-only source while mounted and forgets it on unmount', () => {
    const source: PanelSource = { provenance: null, dossier: dossier() }
    const view = render(inPanel('p1', source))
    expect(panelDossier('p1')).toBe(source.dossier)
    expect(panelSource('p1')).toBeNull()
    view.unmount()
    expect(panelDossier('p1')).toBeNull()
  })

  it('keeps a child chart provenance while the screen registers and re-registers its dossier', () => {
    const chart: PanelSource = { provenance: provenance('R') }
    render(inPanel('p1', chart))
    const first: PanelSource = { provenance: null, dossier: dossier() }
    const view = render(inPanel('p1', first))
    expect(panelSource('p1')).toBe(chart)
    const next: PanelSource = { provenance: null, dossier: dossier() }
    view.rerender(inPanel('p1', next))
    expect(panelDossier('p1')).toBe(next.dossier)
    expect(panelSource('p1')).toBe(chart)
  })

  it('moves from a dossier-only source to one with a provenance, and back', () => {
    const only: PanelSource = { provenance: null, dossier: dossier() }
    const both: PanelSource = { provenance: provenance('ticks'), dossier: dossier() }
    const view = render(inPanel('p1', only))
    view.rerender(inPanel('p1', both))
    expect(panelSource('p1')).toBe(both)
    expect(panelDossier('p1')).toBe(both.dossier)
    view.rerender(inPanel('p1', only))
    expect(panelSource('p1')).toBeNull()
    expect(panelDossier('p1')).toBe(only.dossier)
  })

  it('holds its dossier under StrictMode, which mounts, unmounts and mounts again', () => {
    const source: PanelSource = { provenance: null, dossier: dossier() }
    const view = render(inPanel('p1', source, true))
    expect(panelDossier('p1')).toBe(source.dossier)
    view.unmount()
    expect(panelDossier('p1')).toBeNull()
  })

  it('keeps panels apart', () => {
    const a: PanelSource = { provenance: null, dossier: dossier() }
    const b: PanelSource = { provenance: null, dossier: dossier() }
    render(inPanel('p1', a))
    render(inPanel('p2', b))
    expect(panelDossier('p1')).toBe(a.dossier)
    expect(panelDossier('p2')).toBe(b.dossier)
  })
})
