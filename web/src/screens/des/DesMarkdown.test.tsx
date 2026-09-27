// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as bus from '../../chrome/CommandLine.bus'
import DesMarkdown, { parseBlocks } from './DesMarkdown'

afterEach(cleanup)

const SAMPLE = [
  '# Round 4 screens',
  '',
  'Headline: mean **NET** points per `trade`.',
  'Second line of the same paragraph.',
  '',
  '| spec | n | verdict |',
  '|---|---|---|',
  '| rebal_v0 | 129 | FAIL |',
  '',
  '## Notes',
  '',
  '- **rebal_v0** (FAIL): checks',
  '  - voids: 2011-01',
  '1. first',
].join('\n')

describe('parseBlocks', () => {
  it('splits headings, paragraphs, tables and lists', () => {
    const kinds = parseBlocks(SAMPLE).map((b) => b.kind)
    expect(kinds).toEqual(['heading', 'paragraph', 'table', 'heading', 'list'])
  })

  it('keeps list depth from the indentation', () => {
    const list = parseBlocks(SAMPLE).find((b) => b.kind === 'list')
    expect(list?.kind === 'list' ? list.items.map((i) => i.depth) : []).toEqual([0, 1, 0])
  })

  it('reads a fenced block as preformatted text', () => {
    const blocks = parseBlocks('```\na | b\n```')
    expect(blocks).toEqual([{ kind: 'code', text: 'a | b' }])
  })
})

describe('DesMarkdown', () => {
  it('renders headings, a table with header cells, bold and code as elements', () => {
    render(<DesMarkdown text={SAMPLE} label="Round summary" />)
    expect(screen.getByRole('heading', { name: 'Round 4 screens' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'verdict' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'rebal_v0' })).toBeTruthy()
    expect(screen.getByText('NET').tagName).toBe('STRONG')
    expect(screen.getByText('trade').tagName).toBe('CODE')
    expect(screen.getByText(/Second line of the same paragraph/)).toBeTruthy()
  })

  it('shows markup in the source as text, never as HTML', () => {
    const { container } = render(<DesMarkdown text={'<img src=x onerror="alert(1)"> and <script>x</script>'} label="x" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<img src=x')
  })

  it('shows a link as its text only, with no navigation', () => {
    const { container } = render(<DesMarkdown text="See [the note](https://example.com/x)." label="x" />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('See the note.')
  })

  it('turns a {... <GO>} command into a button that runs the line', () => {
    const spy = vi.spyOn(bus, 'requestLine').mockImplementation(() => {})
    render(<DesMarkdown text="Open {rebal_v0 DES <GO>} now." label="x" />)
    fireEvent.click(screen.getByRole('button', { name: 'rebal_v0 DES <GO>' }))
    expect(spy).toHaveBeenCalledWith('rebal_v0 DES')
  })
})
