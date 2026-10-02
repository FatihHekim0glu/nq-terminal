// @vitest-environment jsdom
// The Radix primitive stub (v2.1 polish, SHELL-DIET-4): vite.config.ts points cmdk's "@radix-ui/react-primitive" import here,
// so Radix's Slot and the fifteen elements cmdk never reads are in no build. These tests pin the stub's contract: it holds
// exactly what cmdk reads (div and input), renders those two as plain elements with every prop, forwards its ref, and fails
// loudly if asChild is ever asked for.
import { act, render } from '@testing-library/react'
import { createElement, createRef, type ComponentProps } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
// cmdk's own module source, the one the alias rewrites (read as text, like the dialog stub's test does).
import cmdkSource from '../../node_modules/cmdk/dist/index.mjs?raw'
import { Primitive } from './radixPrimitiveStub'

const IMPORT = /import\s*\{\s*Primitive\s+as\s+(\w+)\s*\}\s*from\s*"@radix-ui\/react-primitive"/

describe('cmdk against the primitive stub', () => {
  it('still imports the primitive package by the exact specifier the alias matches', () => {
    expect(cmdkSource).toMatch(IMPORT)
  })

  it('reads only .div and .input from it, the two elements the stub has', () => {
    const alias = IMPORT.exec(cmdkSource)?.[1]
    expect(alias).toBeDefined()
    const used = new Set([...cmdkSource.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))].map((m) => m[1]))
    expect([...used].sort()).toEqual(Object.keys(Primitive).sort())
  })

  it('is never given asChild by the terminal\'s own code (the stub would throw)', () => {
    const modules = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx', '!../vendor/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const holders = Object.entries(modules).filter(([, text]) => /\basChild\b/.test(text)).map(([file]) => file)
    expect(holders).toEqual([])
  })
})

describe('the stub', () => {
  it('exports exactly div and input', () => {
    expect(Object.keys(Primitive).sort()).toEqual(['div', 'input'])
  })

  it('renders its tag with every prop it is given', () => {
    // cmdk's own attributes (cmdk-root, cmdk-input) are not in React's element types, so the props are built as a record.
    const divProps = { 'cmdk-root': '', id: 'a', role: 'option', 'aria-selected': true, tabIndex: -1 } as unknown as ComponentProps<typeof Primitive.div>
    const div = renderToString(createElement(Primitive.div, divProps, 'x'))
    expect(div).toBe('<div cmdk-root="" id="a" role="option" aria-selected="true" tabindex="-1">x</div>')
    const inputProps = { 'cmdk-input': '', type: 'text', value: 'NQ', onChange: () => {} } as unknown as ComponentProps<typeof Primitive.input>
    const input = renderToString(createElement(Primitive.input, inputProps))
    expect(input).toBe('<input cmdk-input="" type="text" value="NQ"/>')
  })

  it('forwards its ref to the element', () => {
    const ref = createRef<HTMLDivElement>()
    act(() => {
      render(createElement(Primitive.div, { ref, id: 'target' }))
    })
    expect(ref.current?.id).toBe('target')
  })

  it('fails loudly, naming the stub, if asChild is asked for', () => {
    expect(() => renderToString(createElement(Primitive.div, { asChild: true }))).toThrow(/radixPrimitiveStub/)
    expect(() => renderToString(createElement(Primitive.input, { asChild: true }))).toThrow(/radixPrimitiveStub/)
  })
})
