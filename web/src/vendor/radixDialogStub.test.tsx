// The Radix dialog stub (roadmap wave 7, SHELL-DIET-2): vite.config.ts points cmdk's "@radix-ui/react-dialog"
// import here, so the dialog stack (about 10 kB gzip) is not in any build. The terminal only uses cmdk's
// inline Command list. These tests pin the stub's contract: it exports what cmdk reads, and it fails loudly
// if Command.Dialog is ever rendered instead of silently drawing nothing.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
// cmdk's own module source, the one the alias rewrites (read as text, like the style tests read their stylesheets).
import cmdkSource from '../../node_modules/cmdk/dist/index.mjs?raw'
import * as stub from './radixDialogStub'

const EXPORTS = ['Content', 'Overlay', 'Portal', 'Root'] as const

describe('the Radix dialog stub', () => {
  it('exports exactly the four names cmdk reads from the dialog package', () => {
    expect(Object.keys(stub).sort()).toEqual([...EXPORTS])
  })

  it.each(EXPORTS)('%s throws a message naming Command.Dialog if it is ever rendered', (name) => {
    expect(() => renderToString(createElement(stub[name]))).toThrow(/Command\.Dialog/)
  })
})

describe('cmdk against the stub', () => {
  it('still imports the dialog package by the exact specifier the alias matches', () => {
    expect(cmdkSource).toMatch(/import\s*\*\s*as\s+\w+\s+from\s*"@radix-ui\/react-dialog"/)
  })

  it('reads nothing from the dialog namespace that the stub lacks (an upgrade of cmdk would break Command.Dialog)', () => {
    const alias = /import\s*\*\s*as\s+(\w+)\s+from\s*"@radix-ui\/react-dialog"/.exec(cmdkSource)?.[1]
    expect(alias).toBeDefined()
    const used = new Set([...cmdkSource.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))].map((m) => m[1]))
    expect([...used].sort()).toEqual([...EXPORTS])
  })
})
