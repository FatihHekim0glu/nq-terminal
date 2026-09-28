// Module case guard (roadmap #5, W1-R5a finding 8/18): on a case-insensitive filesystem (macOS,
// Windows) two files whose paths differ only in case resolve as the same module, so an
// extension-less import can silently pick the wrong one depending on the machine. Linux CI has no
// such collapsing, so the same import can resolve differently there. import.meta.glob is lazy here
// (no `eager`), so this test only reads the map's keys: nothing under src is actually imported.
import { describe, expect, it } from 'vitest'

describe('module case', () => {
  it('has no two source files whose module specifier differs only in case', () => {
    const modules = import.meta.glob('/src/**/*.{ts,tsx}')
    const specifiers = Object.keys(modules).map((key) => key.replace(/\.tsx?$/, ''))
    const groups = new Map<string, Set<string>>()
    for (const specifier of specifiers) {
      const lower = specifier.toLowerCase()
      const set = groups.get(lower) ?? new Set<string>()
      set.add(specifier)
      groups.set(lower, set)
    }
    const collisions = [...groups.values()].filter((set) => set.size > 1).map((set) => [...set].sort())
    expect(collisions).toEqual([])
  })
})
