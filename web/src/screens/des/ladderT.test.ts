// N04: the cost-ladder and block bars were drawn as solid green with no dispersion next to a FAIL at alpha t 1.18,
// so the eye read a robust alpha. Where the screen file records a t beside a bar's value, that t is printed with
// the bar. It is read, never computed (C8): no interval is derived from it, so no whisker is drawn, and a bar
// whose t the file does not record, or records two ways, is left as it was.
import { describe, expect, it } from 'vitest'
import { LADDER_T } from '../../copy/ladderT'
import { blocksInput, costInput } from './desModel'
import { VOLMANAGED } from './desTestData'
import { recordedT, withRecordedT } from './ladderT'
import { VOLMANAGED_SCREEN } from './robustness.fixtures'

const RUNGS = VOLMANAGED.des.cost_ladder.map((r) => r.value as number)
const BLOCKS = VOLMANAGED.des.blocks.map((b) => b.value as number)

describe('recordedT: the t the screen file records beside a value', () => {
  it('reads the gating t beside each cost rung of volmanaged_v0', () => {
    expect(RUNGS.map((v) => recordedT(VOLMANAGED_SCREEN, v))).toEqual([1.193755135272809, 1.1762095550806055, 1.1586432725326798])
  })

  it('reads the t beside each block, the smaller of the two lags where the file gives both', () => {
    expect(BLOCKS.map((v) => recordedT(VOLMANAGED_SCREEN, v))).toEqual([1.2415263580667386, -0.4149598997750435, 0.7938824990228023])
  })

  it('returns the very number in the file, unrounded, and never one it worked out', () => {
    const t = recordedT(VOLMANAGED_SCREEN, RUNGS[1])
    expect(t).toBe((VOLMANAGED_SCREEN['headline'] as { '1tick': { alpha: { t_min: number } } })['1tick'].alpha.t_min)
    // a value the file does not hold has no t, however close to one that it does
    expect(recordedT(VOLMANAGED_SCREEN, RUNGS[1]! + 1e-9)).toBeNull()
    expect(recordedT(VOLMANAGED_SCREEN, 3.47)).toBeNull()
  })

  it('has nothing for a missing value, a missing screen or a screen that records no t', () => {
    expect(recordedT(VOLMANAGED_SCREEN, null)).toBeNull()
    expect(recordedT(VOLMANAGED_SCREEN, undefined)).toBeNull()
    expect(recordedT(VOLMANAGED_SCREEN, Number.NaN)).toBeNull()
    expect(recordedT(null, 1)).toBeNull()
    expect(recordedT(undefined, 1)).toBeNull()
    expect(recordedT({ name: 'x' }, 1)).toBeNull()
    expect(recordedT('screen', 1)).toBeNull()
    expect(recordedT({ a: { mean: 2.5 } }, 2.5)).toBeNull()
  })

  it('prefers t_min, then t_nw, then a plain numeric t, and ignores a t that is a table by lag', () => {
    expect(recordedT({ a: { mean: 2.5, t: 9, t_min: 1.5 } }, 2.5)).toBe(1.5)
    expect(recordedT({ a: { mean: 2.5, t: 9, t_nw: 1.6 } }, 2.5)).toBe(1.6)
    expect(recordedT({ a: { mean: 2.5, t: 1.7 } }, 2.5)).toBe(1.7)
    expect(recordedT({ a: { mean: 2.5, t: { 5: 1.7, 21: 1.9 } } }, 2.5)).toBeNull()
    expect(recordedT({ a: { mean: 2.5, t: 'n/a' } }, 2.5)).toBeNull()
  })

  it('finds the value at any depth beside its t, and skips lists (raw draws are not bars)', () => {
    expect(recordedT({ x: { y: { z: { mean: 2.5, t: 1.7 } } } }, 2.5)).toBe(1.7)
    expect(recordedT({ draws: [{ mean: 2.5, t: 1.7 }] }, 2.5)).toBeNull()
  })

  it('reports a t once when the same number is recorded beside the same t in two places', () => {
    expect(recordedT({ a: { mean: 2.5, t: 1.7 }, b: { c: { alpha: 2.5, t: 1.7 } } }, 2.5)).toBe(1.7)
  })

  it('reports none when the file records the value beside two different ts: it will not pick one', () => {
    expect(recordedT({ a: { mean: 2.5, t: 1.7 }, b: { mean: 2.5, t: 0.4 } }, 2.5)).toBeNull()
  })

  it('does not read a count, a seed or a lag as a bar: whole numbers beside a t are left alone', () => {
    expect(recordedT({ a: { n: 2686, seed: 20260926, t_min: 1.5 } }, 2686)).toBeNull()
    expect(recordedT({ a: { n: 2686, seed: 20260926, t_min: 1.5 } }, 20260926)).toBeNull()
  })

  it('does not read a t as a bar: the t keys are not values', () => {
    expect(recordedT({ a: { mean: 2.5, t_min: 1.5, t_b: 7.25 } }, 7.25)).toBeNull()
    expect(recordedT({ a: { mean: 2.5, t_min: 1.5 } }, 1.5)).toBeNull()
  })

  it('is safe on a cyclic or very deep screen', () => {
    const loop: Record<string, unknown> = { mean: 2.5, t: 1.7 }
    loop['self'] = loop
    expect(recordedT(loop, 2.5)).toBe(1.7)
    let deep: Record<string, unknown> = { mean: 5.5, t: 3 }
    for (let i = 0; i < 40; i += 1) deep = { child: deep }
    expect(recordedT(deep, 5.5)).toBeNull()
  })
})

describe('withRecordedT: the ladder with its t under each bar', () => {
  it('appends "t 1.18" to each cost rung label, two decimals, and counts the bars it touched', () => {
    const base = costInput(VOLMANAGED.des, 'volmanaged_v0')!
    const { input, count } = withRecordedT(base, VOLMANAGED_SCREEN)
    expect(count).toBe(3)
    expect(input!.bars.map((b) => b.label)).toEqual(['0 ticks, t 1.19', '1 tick, t 1.18', '2 ticks, t 1.16'])
    expect(LADDER_T.bar).toBe('{label}, t {t}')
  })

  it('appends the t of each block, with its sign', () => {
    const { input, count } = withRecordedT(blocksInput(VOLMANAGED.des, 'volmanaged_v0'), VOLMANAGED_SCREEN)
    expect(count).toBe(3)
    expect(input!.bars.map((b) => b.label)).toEqual(['2010-13, t 1.24', '2014-17, t -0.41', '2018-21, t 0.79'])
  })

  it('changes only the labels: values, unit, marker and the absence of whiskers stay as the file gave them (C8)', () => {
    const base = costInput(VOLMANAGED.des, 'volmanaged_v0')!
    const { input } = withRecordedT(base, VOLMANAGED_SCREEN)
    expect(input!.bars.map((b) => b.value)).toEqual(base.bars.map((b) => b.value))
    expect(input!.bars.every((b) => b.lo === undefined && b.hi === undefined)).toBe(true)
    expect(input!.marker).toEqual(base.marker)
    expect(input!.unit).toBe(base.unit)
    expect(input!.name).toBe(base.name)
    expect(input!.decimals).toBe(base.decimals)
    expect(base.bars.map((b) => b.label)).toEqual(['0 ticks', '1 tick', '2 ticks'])
  })

  it('leaves a bar with no recorded t as it was, and touches the others', () => {
    const base = blocksInput(VOLMANAGED.des, 'volmanaged_v0')!
    const screen = { blocks_1tick: { a: { alpha_annual_pct: BLOCKS[0], t_min: 1.25 } } }
    const { input, count } = withRecordedT(base, screen)
    expect(count).toBe(1)
    expect(input!.bars.map((b) => b.label)).toEqual(['2010-13, t 1.25', '2014-17', '2018-21'])
  })

  it('hands back the same ladder when the file records no t, and nothing for no ladder', () => {
    const base = costInput(VOLMANAGED.des, 'volmanaged_v0')!
    const none = withRecordedT(base, VOLMANAGED.screen)
    expect(none).toEqual({ input: base, count: 0 })
    expect(none.input).toBe(base)
    expect(withRecordedT(null, VOLMANAGED_SCREEN)).toEqual({ input: null, count: 0 })
  })

  it('does not touch a bar with no value', () => {
    const base = { name: 'n', bars: [{ label: 'a', value: null }, { label: 'b', value: 2.5 }] }
    const { input, count } = withRecordedT(base, { s: { mean: 2.5, t: 1.234 } })
    expect(count).toBe(1)
    expect(input!.bars.map((b) => b.label)).toEqual(['a', 'b, t 1.23'])
  })
})
