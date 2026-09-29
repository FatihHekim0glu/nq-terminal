import { describe, expect, it } from 'vitest'
import type { HealthData } from '../commands/types'
import type { HealthState } from './StatusBar'
import { killState } from './StatusBar.format'

const HEALTH: HealthData = {
  fence: { is_start: '2010-01-01', is_end: '2022-01-01' },
  kill_switch_on: false,
  gate_reads_this_process: 0,
  fixture_mode: false,
}

describe('killState: the one reading of the kill switch that the nav toolbar and the status line share', () => {
  it('says reading while the health poll has not answered', () => {
    expect(killState({ status: 'loading' })).toBe('reading')
  })

  it('says unknown when the health poll failed, never the answer before it', () => {
    expect(killState({ status: 'error' })).toBe('unknown')
  })

  it('says off and on from the served kill_switch_on flag', () => {
    expect(killState({ status: 'ok', data: HEALTH })).toBe('off')
    expect(killState({ status: 'ok', data: { ...HEALTH, kill_switch_on: true } })).toBe('on')
  })

  it('covers every health state with one of the four words', () => {
    const states: readonly HealthState[] = [{ status: 'loading' }, { status: 'error' }, { status: 'ok', data: HEALTH }, { status: 'ok', data: { ...HEALTH, kill_switch_on: true } }]
    expect(states.map(killState)).toEqual(['reading', 'unknown', 'off', 'on'])
  })
})
