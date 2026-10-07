import { describe, expect, it, vi } from 'vitest'
import { IB_SWITCH_OFF_URI, IB_SWITCH_ON_URI, ibSwitchUri, requestIbSwitch } from './ibSwitch'

describe('the IB snapshot switch addresses', () => {
  it('are the two exact addresses the desktop shell recognises', () => {
    expect(IB_SWITCH_ON_URI).toBe('http://tauri.localhost/ib-snapshot/on')
    expect(IB_SWITCH_OFF_URI).toBe('http://tauri.localhost/ib-snapshot/off')
    expect(ibSwitchUri(true)).toBe(IB_SWITCH_ON_URI)
    expect(ibSwitchUri(false)).toBe(IB_SWITCH_OFF_URI)
  })

  it('asks by navigating with the injected assign, once, to the address for the value asked for', () => {
    const assign = vi.fn()
    requestIbSwitch(true, assign)
    requestIbSwitch(false, assign)
    expect(assign.mock.calls).toEqual([[IB_SWITCH_ON_URI], [IB_SWITCH_OFF_URI]])
  })
})
