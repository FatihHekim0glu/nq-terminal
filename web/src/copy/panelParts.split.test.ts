// The workspace copy's shell rule (SHELL-DIET): copy/workspace.ts is part of the first-paint shell (WORKSPACE
// and fillCopy are read by the frame), so the copy only the panels' parts read lives in copy/panelParts.ts:
// the export line, the related functions menu, the quote header, the field and the chart wrapper, and the
// tab sets. Nothing that loads with the shell may import it. This reads the sources as text.
//
// PANEL, FUNCTION_BAR, FUNCTION_NUMBERS and PLACEHOLDER are lazy-only too, but stay in workspace.ts for now:
// screens/reg/RegScreen.tsx and chrome/Workspace.test.tsx import them from there. Once those two import from
// panelParts, they can move as well (about 1 kB gzip).
import { describe, expect, it } from 'vitest'
import { CHART, EXPORT, FIELD, QUOTE, RELATED, TAB_SETS } from './panelParts'
import * as workspace from './workspace'
import * as panelParts from './panelParts'

const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Files whose code loads with index.html, as far as this rule goes (the build check is the full proof). */
const SHELL_FILES = [
  '/src/App.tsx',
  '/src/AppCommandBar.tsx',
  '/src/main.tsx',
  '/src/api/ApiProvider.tsx',
  '/src/chrome/CommandLine.tsx',
  '/src/chrome/CommandLine.dispatch.ts',
  '/src/chrome/CommandLine.menus.ts',
  '/src/chrome/ConnectionStrip.tsx',
  '/src/chrome/FrameStrip.tsx',
  '/src/chrome/KeyToolbar.actions.ts',
  '/src/chrome/NavToolbar.tsx',
  '/src/chrome/RecordWatch.live.tsx',
  '/src/chrome/StatusBar.tsx',
  '/src/chrome/useDeepLinks.ts',
]

const importsPanelParts = (text: string) => /\bfrom\s+['"][^'"]*\bcopy\/panelParts['"]/.test(text)

describe('panelParts: the panels\' parts', () => {
  it('holds exactly the export, related, quote, field, chart and tab set copy', () => {
    expect(Object.keys(panelParts).sort()).toEqual(['CHART', 'EXPORT', 'FIELD', 'QUOTE', 'RELATED', 'TAB_SETS'])
  })

  it('keeps the strings the panels showed before the move', () => {
    expect(EXPORT.csv).toBe('Shown rows as CSV')
    expect(EXPORT.done).toBe('Saved {n} rows as {file}.')
    expect(RELATED.title).toBe('Related functions')
    expect(QUOTE.label).toBe('Quote for {ticker}')
    expect(FIELD.listLabel).toBe('{label} choices')
    expect(CHART.readoutLabel).toBe('Crosshair readout')
    expect(TAB_SETS.analytics.tabs.EQ).toBe('Equity')
  })
})

describe('workspace.ts: what the shell reads', () => {
  it('no longer holds the parts copy, and still holds WORKSPACE and fillCopy', () => {
    const names = Object.keys(workspace)
    for (const moved of ['CHART', 'EXPORT', 'FIELD', 'QUOTE', 'RELATED', 'TAB_SETS']) expect(names, moved).not.toContain(moved)
    expect(names).toEqual(expect.arrayContaining(['WORKSPACE', 'fillCopy', 'PANEL', 'FUNCTION_BAR', 'FUNCTION_NUMBERS', 'PLACEHOLDER']))
  })
})

describe('who reads panelParts', () => {
  it('scans the real sources, and every shell file exists', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining(SHELL_FILES))
  })

  it('no shell file imports copy/panelParts', () => {
    const readers = Object.entries(SOURCES)
      .filter(([, text]) => importsPanelParts(text))
      .map(([file]) => file)
    expect(readers.length).toBeGreaterThan(0)
    for (const file of SHELL_FILES) expect(readers, file).not.toContain(file)
  })
})
