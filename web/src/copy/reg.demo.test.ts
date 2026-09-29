// @vitest-environment jsdom
// U01: REG's provenance line said 'values read from results/registry.csv through the API', which is not what the
// demo does: it serves a snapshot of the registry captured from the real research files, in the page. The line
// reads the page's demo mark (data-demo, set by src/demo/boot.tsx) each time it is used, so it needs no other file.
import { afterEach, describe, expect, it } from 'vitest'
import { findCopyViolations } from './copyRules'
import { REG } from './reg'

afterEach(() => {
  delete document.documentElement.dataset.demo
})

describe('REG.criteriaSource', () => {
  it('reads the file through the API on a real backend, as it always did', () => {
    expect(REG.criteriaSource).toBe('values read from results/registry.csv through the API')
  })

  it('names the demo snapshot in the demo, and no longer claims the API', () => {
    document.documentElement.dataset.demo = 'on'
    expect(REG.criteriaSource).toBe('values from the demo snapshot of results/registry.csv, served in this page')
    expect(REG.criteriaSource).not.toMatch(/through the API/)
  })

  it('follows the page mark each time, not once at load', () => {
    document.documentElement.dataset.demo = 'on'
    expect(REG.criteriaSource).toMatch(/demo snapshot/)
    delete document.documentElement.dataset.demo
    expect(REG.criteriaSource).toMatch(/through the API/)
    document.documentElement.dataset.demo = 'off'
    expect(REG.criteriaSource).toMatch(/through the API/)
  })

  it('is house style in both forms: no dashes, UK spelling', () => {
    expect(findCopyViolations(REG)).toEqual([])
    document.documentElement.dataset.demo = 'on'
    expect(findCopyViolations(REG)).toEqual([])
    expect(findCopyViolations({ criteriaSource: REG.criteriaSource })).toEqual([])
  })
})
