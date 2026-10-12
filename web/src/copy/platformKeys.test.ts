import { describe, expect, it } from 'vitest'
import { COMMAND_LINE } from './commands'
import { KEY_TOOLBAR, MESSAGES, NAV_TOOLBAR } from './chrome'
import { GRAB } from './grab'
import { MAC_KEYMAP_NAME, MAC_KEY_TOOLBAR_NAMES, MAC_NAV_NAMES, keyWords } from './platformKeys'

const PC_ONLY_KEY = /\b(Alt|Ctrl|End|PgUp|PgDn)\b/

describe('platformKeys: the Mac table never names a key a Mac laptop lacks', () => {
  it('names Back and Forward by Cmd+[ and Cmd+], not End', () => {
    expect(MAC_NAV_NAMES.back).toMatch(/^Back, Cmd\+\[/)
    expect(MAC_NAV_NAMES.forward).toMatch(/^Forward, Cmd\+\]/)
    for (const name of Object.values(MAC_NAV_NAMES)) expect(name).not.toMatch(PC_ONLY_KEY)
    expect(NAV_TOOLBAR.back).toMatch(PC_ONLY_KEY)
  })

  it('names the page keys by Fn+Up and Fn+Down, and the key map by Option+K', () => {
    for (const name of Object.values(MAC_KEY_TOOLBAR_NAMES)) expect(name).not.toMatch(PC_ONLY_KEY)
    expect(MAC_KEY_TOOLBAR_NAMES.pgback).toMatch(/Fn\+Up/)
    expect(MAC_KEY_TOOLBAR_NAMES.pgfwd).toMatch(/Fn\+Down/)
    expect(MAC_KEYMAP_NAME).toBe('Key map, Option+K')
    expect(KEY_TOOLBAR.keymap).toBe('Key map, Alt+K')
  })

  it('keeps the same action words as the PC names', () => {
    expect(MAC_KEY_TOOLBAR_NAMES.pgback.split(': ')[1]).toBe(KEY_TOOLBAR.keys.pgback.name.split(': ')[1])
    expect(MAC_KEY_TOOLBAR_NAMES.pgfwd.split(': ')[1]).toBe(KEY_TOOLBAR.keys.pgfwd.name.split(': ')[1])
  })

  it('says Option for Alt in the messages on a Mac and leaves the PC wording alone', () => {
    for (const text of [MESSAGES.keymapOpen, COMMAND_LINE.grabUnavailable, GRAB.noPanel]) {
      expect(text).toMatch(/Alt\+/)
      expect(keyWords(text, 'pc')).toBe(text)
      expect(keyWords(text, 'mac')).not.toMatch(PC_ONLY_KEY)
      expect(keyWords(text, 'mac')).toMatch(/Option\+/)
    }
    expect(keyWords(MESSAGES.keymapOpen, 'mac')).toBe('Key map open. <Option+K> or <Esc> closes it.')
  })
})
