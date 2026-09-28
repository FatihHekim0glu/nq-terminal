import { describe, expect, it } from 'vitest'
import type { SerializedDockview } from 'dockview-react'
import { fnv1a, fromStored, layoutSignature, readDock, toStored } from './WorkspaceStorage'

const DOCK = {
  grid: { root: { type: 'branch', data: [] }, width: 100, height: 100, orientation: 'HORIZONTAL' },
  panels: { 'home-gp': { id: 'home-gp', contentComponent: 'screen', params: {} } },
  activeGroup: '1',
} as unknown as SerializedDockview

describe('saved workspace layouts', () => {
  it('hashes text stably and tells different texts apart', () => {
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('HOME')).toBe(fnv1a('HOME'))
    expect(fnv1a('HOME')).not.toBe(fnv1a('HOMF'))
  })

  it('gives each screen default its own signature', () => {
    expect(layoutSignature('HOME')).not.toBe(layoutSignature('REG'))
  })

  it('round-trips a layout saved from the current default', () => {
    expect(fromStored('HOME', toStored('HOME', DOCK))).toEqual(DOCK)
  })

  it('born failing: drops a layout saved from another default (or from before signatures)', () => {
    expect(fromStored('HOME', { base: '00000000', dock: DOCK })).toBeNull()
    expect(fromStored('HOME', DOCK as unknown as Record<string, unknown>)).toBeNull()
    expect(fromStored('REG', toStored('HOME', DOCK))).toBeNull()
  })

  it.each(['floatingGroups', 'popoutGroups', 'edgeGroups'])('born failing: refuses a layout that asks for %s', (key) => {
    const dock = { ...DOCK, [key]: [{ data: {} }] } as unknown as SerializedDockview
    expect(fromStored('HOME', toStored('HOME', dock))).toBeNull()
    const empty = { ...DOCK, [key]: [] } as unknown as SerializedDockview
    expect(fromStored('HOME', toStored('HOME', empty))).toEqual(empty)
  })

  it('born failing: refuses a layout holding a panel of another component, or no panels', () => {
    const foreign = { ...DOCK, panels: { x: { id: 'x', contentComponent: 'iframe', params: {} } } } as unknown as SerializedDockview
    expect(fromStored('HOME', toStored('HOME', foreign))).toBeNull()
    const none = { ...DOCK, panels: {} } as unknown as SerializedDockview
    expect(fromStored('HOME', toStored('HOME', none))).toBeNull()
  })
})

describe('readDock: the structural checks alone, with no signature check (undo, a stale-base drop)', () => {
  it('accepts a layout saved under a stale, or altogether missing, base', () => {
    expect(readDock({ base: '00000000', dock: DOCK })).toEqual(DOCK)
    expect(readDock({ dock: DOCK })).toEqual(DOCK)
  })

  it.each(['floatingGroups', 'popoutGroups', 'edgeGroups'])('refuses a layout that asks for %s, stale base or not', (key) => {
    const dock = { ...DOCK, [key]: [{ data: {} }] } as unknown as SerializedDockview
    expect(readDock({ base: '00000000', dock })).toBeNull()
    const empty = { ...DOCK, [key]: [] } as unknown as SerializedDockview
    expect(readDock({ base: '00000000', dock: empty })).toEqual(empty)
  })

  it('refuses a layout holding a panel of another component, or no panels, or no grid', () => {
    const foreign = { ...DOCK, panels: { x: { id: 'x', contentComponent: 'iframe', params: {} } } } as unknown as SerializedDockview
    expect(readDock({ base: '00000000', dock: foreign })).toBeNull()
    const none = { ...DOCK, panels: {} } as unknown as SerializedDockview
    expect(readDock({ base: '00000000', dock: none })).toBeNull()
    expect(readDock({ base: '00000000', dock: 'not a dock' })).toBeNull()
  })

  it('fromStored is exactly the signature check plus readDock', () => {
    const stored = toStored('HOME', DOCK)
    expect(fromStored('HOME', stored)).toEqual(readDock(stored))
    const stale = { base: '00000000', dock: DOCK }
    expect(fromStored('HOME', stale)).toBeNull()
    expect(readDock(stale)).toEqual(DOCK)
  })
})
