// The connection copy's shell rule (W4-INT): CONNECTION holds only what the always-mounted strip and
// PanelFault's outage line read (the strip's own lines plus noAnswer, which both read). The panel
// waiting and retry lines live in CONNECTION_PANEL (copy/connectionPanel.ts), read by PanelFault and
// GpStatus only, so the shell chunk does not carry them twice. This reads the sources as text.
import { describe, expect, it } from 'vitest'
import { CONNECTION } from './connection'
import { CONNECTION_PANEL } from './connectionPanel'

const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const PANEL_READERS = ['/src/chrome/PanelFault.tsx', '/src/screens/gp/GpStatus.tsx']

describe('CONNECTION: the shell lines', () => {
  it('holds the strip lines and noAnswer, and nothing else', () => {
    expect(Object.keys(CONNECTION)).toEqual(['lead', 'down', 'next', 'checkNow', 'checkNowLabel', 'back', 'noAnswer'])
  })

  it('keeps noAnswer as the words for a request the backend never answered', () => {
    expect(CONNECTION.noAnswer).toBe('no answer')
  })
})

describe('CONNECTION_PANEL: the panel waiting and retry lines', () => {
  it('holds exactly the waiting and retry keys', () => {
    expect(Object.keys(CONNECTION_PANEL)).toEqual(['waiting', 'waitingLoad', 'retry', 'retryLabel'])
  })

  it('keeps the strings the panels showed before the split', () => {
    expect(CONNECTION_PANEL).toEqual({
      waiting: 'Waiting for the backend: {request} answered {answer}.',
      waitingLoad: 'Waiting for the backend before loading.',
      retry: 'Retry',
      retryLabel: 'Retry this request',
    })
  })
})

describe('who reads CONNECTION_PANEL', () => {
  it('scans the real sources, and both readers exist', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining(PANEL_READERS))
  })

  it('only PanelFault and GpStatus import copy/connectionPanel', () => {
    const readers = Object.entries(SOURCES)
      .filter(([, text]) => text.includes('copy/connectionPanel'))
      .map(([file]) => file)
      .sort()
    expect(readers).toEqual([...PANEL_READERS].sort())
  })
})
