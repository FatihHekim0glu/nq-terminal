// The key messages' shell rule (SHELL-DIET): the BACK and FORWARD lines and the reserved F-key lines are read
// by the key toolbar's actions (KeyToolbar.actions.ts, part of the first-paint shell), so they live in
// copy/navKeys.ts. copy/help.ts holds what the HELP screen and the key map overlay read, both of which load
// later, and must stay out of the shell. This reads the sources as text.
import { describe, expect, it } from 'vitest'
import * as help from './help'
import { NAV_MESSAGES, RESERVED_F_MESSAGES } from './navKeys'

const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** An import statement for a copy file, from anywhere (a comment that names the file does not count). */
const importsCopy = (text: string, name: string) => new RegExp(String.raw`\bfrom\s+['"][^'"]*\bcopy/${name}['"]`).test(text)

describe('navKeys: the shell lines', () => {
  it('keeps the strings the key toolbar posted before the move', () => {
    expect(NAV_MESSAGES).toEqual({ backTo: 'Back to {value}.', forwardTo: 'Forward to {value}.' })
    expect(Object.keys(RESERVED_F_MESSAGES)).toEqual(['F3', 'F5', 'F6', 'F7'])
    expect(RESERVED_F_MESSAGES.F5).toBe('F5 would reload: every panel history would be lost. Type HOME <GO> instead.')
    expect(RESERVED_F_MESSAGES.F3).toContain('browser find bar')
    expect(RESERVED_F_MESSAGES.F6).toContain('address bar')
    expect(RESERVED_F_MESSAGES.F7).toContain('caret browsing')
  })
})

describe('help.ts: what only the HELP screen and the key map read', () => {
  it('no longer holds the key messages', () => {
    expect(Object.keys(help)).not.toContain('NAV_MESSAGES')
    expect(Object.keys(help)).not.toContain('RESERVED_F_MESSAGES')
    expect(Object.keys(help)).toEqual(expect.arrayContaining(['HELP', 'HELP_KEYS', 'HELP_KEYBOARD', 'HELP_LICENCES', 'HELP_FONT_LICENCES']))
  })
})

describe('who reads what', () => {
  it('scans the real sources, and the reader exists', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining(['/src/chrome/KeyToolbar.actions.ts']))
  })

  it('only chrome/KeyToolbar.actions.ts imports copy/navKeys', () => {
    const readers = Object.entries(SOURCES)
      .filter(([, text]) => importsCopy(text, 'navKeys'))
      .map(([file]) => file)
    expect(readers).toEqual(['/src/chrome/KeyToolbar.actions.ts'])
  })

  it('the shell file that reads the key messages no longer imports copy/help', () => {
    expect(importsCopy(SOURCES['/src/chrome/KeyToolbar.actions.ts'] ?? '', 'help')).toBe(false)
  })
})
