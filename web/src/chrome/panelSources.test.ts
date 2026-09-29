// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { createElement, StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { GrabProvenance } from '../export/grab/grabModel'
import { PanelActionsContext, type PanelActions } from './PanelChrome.actions'
import { panelSource, registerPanelSource, resetPanelSources, usePanelSource, type PanelSource } from './panelSources'

afterEach(() => {
  cleanup()
  resetPanelSources()
})

const NONE: GrabProvenance = { tags: [], basis: null, unit: null, window: null, n: null, source: null, specSha: null }
const sourceOf = (unit: string): PanelSource => ({ provenance: { ...NONE, unit } })

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

describe('the panel source registry', () => {
  it('answers null for a panel that registered nothing', () => {
    expect(panelSource('p1')).toBeNull()
  })

  it('returns what a panel registered, by panel id', () => {
    const a = sourceOf('ticks')
    const b = sourceOf('R')
    registerPanelSource('p1', a)
    registerPanelSource('p2', b)
    expect(panelSource('p1')).toBe(a)
    expect(panelSource('p2')).toBe(b)
  })

  it('lets the latest registration win', () => {
    const first = sourceOf('ticks')
    const second = sourceOf('R')
    registerPanelSource('p1', first)
    registerPanelSource('p1', second)
    expect(panelSource('p1')).toBe(second)
  })

  it('removes a registration with its disposer', () => {
    const dispose = registerPanelSource('p1', sourceOf('ticks'))
    dispose()
    expect(panelSource('p1')).toBeNull()
  })

  it('lets a disposer remove only its own registration, never a later one', () => {
    const disposeFirst = registerPanelSource('p1', sourceOf('ticks'))
    const later = sourceOf('R')
    registerPanelSource('p1', later)
    disposeFirst()
    expect(panelSource('p1')).toBe(later)
  })

  it('keeps a second registration of the same object when the first one is disposed', () => {
    const same = sourceOf('ticks')
    const disposeFirst = registerPanelSource('p1', same)
    const disposeSecond = registerPanelSource('p1', same)
    disposeFirst()
    expect(panelSource('p1')).toBe(same)
    disposeSecond()
    expect(panelSource('p1')).toBeNull()
  })

  it('does not fail when a disposer runs twice', () => {
    const dispose = registerPanelSource('p1', sourceOf('ticks'))
    registerPanelSource('p1', sourceOf('R'))
    dispose()
    dispose()
    expect(panelSource('p1')?.provenance?.unit).toBe('R')
  })

  it('forgets everything on reset', () => {
    registerPanelSource('p1', sourceOf('ticks'))
    resetPanelSources()
    expect(panelSource('p1')).toBeNull()
  })
})

describe('usePanelSource', () => {
  it('registers for the panel it sits in while mounted, and forgets on unmount', () => {
    const source = sourceOf('ticks')
    const view = render(inPanel('p1', source))
    expect(panelSource('p1')).toBe(source)
    view.unmount()
    expect(panelSource('p1')).toBeNull()
  })

  it('follows a changed source', () => {
    const view = render(inPanel('p1', sourceOf('ticks')))
    const next = sourceOf('R')
    view.rerender(inPanel('p1', next))
    expect(panelSource('p1')).toBe(next)
  })

  it('forgets when the source becomes null', () => {
    const view = render(inPanel('p1', sourceOf('ticks')))
    view.rerender(inPanel('p1', null))
    expect(panelSource('p1')).toBeNull()
  })

  it('registers nothing for a null source', () => {
    render(inPanel('p1', null))
    expect(panelSource('p1')).toBeNull()
  })

  it('does nothing outside a workspace, where the panel id is empty', () => {
    render(inPanel('', sourceOf('ticks')))
    expect(panelSource('')).toBeNull()
  })

  it('does nothing without any panel context at all', () => {
    render(createElement(Probe, { source: sourceOf('ticks') }))
    expect(panelSource('')).toBeNull()
  })

  it('holds its registration under StrictMode, which mounts, unmounts and mounts again', () => {
    const source = sourceOf('ticks')
    const view = render(inPanel('p1', source, true))
    expect(panelSource('p1')).toBe(source)
    view.unmount()
    expect(panelSource('p1')).toBeNull()
  })

  it('keeps the newer source when an older tab in the same panel unmounts afterwards', () => {
    const older = sourceOf('ticks')
    const newer = sourceOf('R')
    const olderView = render(inPanel('p1', older))
    render(inPanel('p1', newer))
    expect(panelSource('p1')).toBe(newer)
    olderView.unmount()
    expect(panelSource('p1')).toBe(newer)
  })

  it('keeps panels apart', () => {
    const a = sourceOf('ticks')
    const b = sourceOf('R')
    render(inPanel('p1', a))
    render(inPanel('p2', b))
    expect(panelSource('p1')).toBe(a)
    expect(panelSource('p2')).toBe(b)
  })
})
