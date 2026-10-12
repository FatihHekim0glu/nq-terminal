// The judge of a self-test report: what the desktop spec (and any later runner, such as the Mac's) asks of the page's
// `window.__selftest`. Every guard is born failing: each case below feeds it the broken state and expects a named failure.
import { describe, expect, it } from 'vitest'
import { AXE_INCOMPLETE_ALLOWED, AXE_TAGS, GOLDEN_NAMES, GOLDEN_TOLERANCE, MIN_AXE_PASSES, PROBE_NAMES, judgeReport } from './report.ts'
import { changed, passingReport } from './report.testUtil.ts'

describe('judgeReport', () => {
  it('passes a report whose goldens are met, probes passed and axe clean', () => {
    expect(judgeReport(passingReport())).toEqual([])
  })

  it('names the contract: four goldens, five probes, the WCAG 2.2 AA tags, one part in 1e9', () => {
    expect(GOLDEN_NAMES).toEqual(['p12_expectation', 'p12_neff', 'p12_power', 'p2_neff_served'])
    expect(PROBE_NAMES).toEqual(['perspective_wasm32', 'dockview_layout_restore', 'stream_mode', 'text_copy', 'blob_export'])
    expect(AXE_TAGS).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    expect(GOLDEN_TOLERANCE).toBe(1e-9)
  })

  it('born failing: one golden off by 1e-6 fails, and the failure names it', () => {
    const off = changed(passingReport(), (r) => {
      const power = r.goldens.find((g) => g.name === 'p12_power')!
      power.maxRelativeError = 1e-6
      power.failed = 1
      power.passed = false
    })
    const failures = judgeReport(off)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('p12_power')
  })

  it('does not trust a golden that says it passed: the numbers decide', () => {
    const lying = changed(passingReport(), (r) => {
      const golden = r.goldens.find((g) => g.name === 'p12_neff')!
      golden.maxRelativeError = 1e-6 // still says passed: true, failed: 0
    })
    expect(judgeReport(lying).join('\n')).toContain('p12_neff')
    const counted = changed(passingReport(), (r) => {
      r.goldens[0]!.failed = 1 // still says passed: true, error tiny
    })
    expect(judgeReport(counted).join('\n')).toContain(GOLDEN_NAMES[0])
  })

  it('holds the line at 1e-9: 5e-10 passes, 2e-9 fails', () => {
    const at = (error: number) => changed(passingReport(), (r) => { r.goldens[1]!.maxRelativeError = error })
    expect(judgeReport(at(5e-10))).toEqual([])
    expect(judgeReport(at(2e-9))).toHaveLength(1)
  })

  it('fails a missing, repeated or empty golden, and an error that is not a finite number', () => {
    expect(judgeReport(changed(passingReport(), (r) => { r.goldens.pop() })).join('\n')).toContain('p2_neff_served')
    expect(judgeReport(changed(passingReport(), (r) => { r.goldens.push(r.goldens[0]!) })).join('\n')).toMatch(/p12_expectation.*(twice|more than once)/)
    expect(judgeReport(changed(passingReport(), (r) => { r.goldens[2]!.checks = 0 })).join('\n')).toContain('p12_power')
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null, 'x']) {
      const broken = changed(passingReport(), (r) => { (r.goldens[3] as unknown as { maxRelativeError: unknown }).maxRelativeError = bad })
      expect(judgeReport(broken).join('\n'), String(bad)).toContain('p2_neff_served')
    }
  })

  it('fails an axe violation, and names the rule', () => {
    const dirty = changed(passingReport(), (r) => {
      r.axe!.violations = [{ id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum colour contrast', nodes: 3 }]
    })
    const failures = judgeReport(dirty)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('color-contrast')
  })

  it('born failing: an axe run that evaluated almost nothing (0 passes, or one under the floor) fails', () => {
    expect(MIN_AXE_PASSES).toBe(20)
    expect(judgeReport(changed(passingReport(), (r) => { r.axe!.passes = 0 })).join('\n')).toMatch(/axe.*0 rules passed.*at least 20/)
    expect(judgeReport(changed(passingReport(), (r) => { r.axe!.passes = MIN_AXE_PASSES - 1 })).join('\n')).toMatch(/axe.*19 rules passed/)
    expect(judgeReport(changed(passingReport(), (r) => { r.axe!.passes = MIN_AXE_PASSES }))).toEqual([])
    for (const bad of [null, 'x', Number.NaN]) {
      const broken = changed(passingReport(), (r) => { (r.axe as unknown as { passes: unknown }).passes = bad })
      expect(judgeReport(broken).join('\n'), String(bad)).toMatch(/axe.*rules passed/)
    }
  })

  it('born failing: an undecided axe check on a rule that is not allowed fails, and names the rule and where', () => {
    const undecided = changed(passingReport(), (r) => {
      r.axe!.incomplete = 1
      r.axe!.incompleteRules = [{ id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum colour contrast', nodes: 2, targets: ['#probe-log', '.status'] }]
    })
    const failures = judgeReport(undecided)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('color-contrast')
    expect(failures[0]).toContain('#probe-log')
    expect(failures[0]).toMatch(/undecided/)
  })

  it('lets an undecided rule through only when it is on the reasoned allowlist', () => {
    const rule = 'aria-allowed-role'
    const undecided = changed(passingReport(), (r) => {
      r.axe!.incomplete = 1
      r.axe!.incompleteRules = [{ id: rule, impact: null, help: 'h', nodes: 1 }]
    })
    expect(judgeReport(undecided)).toHaveLength(1)
    expect(judgeReport(undecided, { allowIncomplete: [rule] })).toEqual([])
    expect(Object.values(AXE_INCOMPLETE_ALLOWED).every((reason) => reason.length > 20)).toBe(true)
  })

  it('fails an undecided list that is missing or disagrees with its own count', () => {
    expect(judgeReport(changed(passingReport(), (r) => { delete (r.axe as { incompleteRules?: unknown }).incompleteRules })).join('\n')).toMatch(/axe.*undecided/)
    expect(judgeReport(changed(passingReport(), (r) => { r.axe!.incomplete = 2 })).join('\n')).toMatch(/axe counts 2 undecided rules but lists 0/)
  })

  it('fails an axe run that did not use the WCAG 2.2 AA tags, or did not run', () => {
    expect(judgeReport(changed(passingReport(), (r) => { r.axe!.tags = ['wcag2a'] })).join('\n')).toMatch(/axe.*tags/)
    expect(judgeReport(changed(passingReport(), (r) => { r.axe = null })).join('\n')).toMatch(/axe did not run/)
  })

  it('fails a probe that failed, was skipped or is missing; a skip is allowed only when named', () => {
    const failed = changed(passingReport(), (r) => { r.probes[0] = { ...r.probes[0]!, status: 'fail', detail: 'no wasm' } })
    expect(judgeReport(failed).join('\n')).toContain('perspective_wasm32')
    expect(judgeReport(failed).join('\n')).toContain('no wasm')
    const skipped = changed(passingReport(), (r) => { r.probes[2] = { ...r.probes[2]!, status: 'skip' } })
    expect(judgeReport(skipped).join('\n')).toContain('stream_mode')
    expect(judgeReport(skipped, { allowSkipped: ['stream_mode'] })).toEqual([])
    const missing = changed(passingReport(), (r) => { r.probes = r.probes.filter((p) => p.name !== 'blob_export') })
    expect(judgeReport(missing).join('\n')).toContain('blob_export')
  })

  it('fails a report that is not finished, has another schema, or is not a report at all', () => {
    expect(judgeReport(changed(passingReport(), (r) => { r.state = 'awaiting-gesture' })).join('\n')).toContain('awaiting-gesture')
    expect(judgeReport(changed(passingReport(), (r) => { (r as unknown as { schema: number }).schema = 2 })).join('\n')).toContain('schema')
    for (const junk of [null, undefined, 'done', 7, [], {}]) {
      expect(judgeReport(junk).length, JSON.stringify(junk)).toBeGreaterThan(0)
    }
  })

  it('reports every failure at once, not only the first', () => {
    const wrecked = changed(passingReport(), (r) => {
      r.goldens[0]!.maxRelativeError = 1
      r.probes[1] = { ...r.probes[1]!, status: 'fail' }
      r.axe!.violations = [{ id: 'label', impact: 'critical', help: 'h', nodes: 1 }]
    })
    expect(judgeReport(wrecked).length).toBeGreaterThanOrEqual(3)
  })
})
