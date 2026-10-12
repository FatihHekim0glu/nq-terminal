// KeyToolbar (spec 4.2): the 32px key toolbar. The official keys that mean something in nq-lab, in
// their order (CANCEL red; HELP, SEARCH, MENU, PG BACK, PG FWD green), then custom keys for our own
// screens (HOME, REG, RUNS, LEDG, LIVE, OOS), then a wrench for the key map. Buttons are 24px tall on
// a 48px pitch, black uppercase labels clipped at the edge, square corners; each names its key and
// action for assistive technology. No sector keys: F8 to F11 insert them.
import type { MouseEvent } from 'react'
import { KEY_TOOLBAR } from '../copy/chrome'
import { MAC_KEYMAP_NAME, MAC_KEY_TOOLBAR_NAMES } from '../copy/platformKeys'
import { detectKeysTable, type KeysTable } from './CommandLine.keys'
import './KeyToolbar.css'

export type OfficialKey = keyof typeof KEY_TOOLBAR.keys
export type CustomKey = keyof typeof KEY_TOOLBAR.custom
export type KeyId = OfficialKey | CustomKey | 'keymap'

export interface KeyToolbarProps {
  readonly onKey: (key: KeyId) => void
  /** The key bindings the accessible names speak; the platform's own when absent. */
  readonly keys?: KeysTable
}

const OFFICIAL: readonly OfficialKey[] = ['esc', 'help', 'search', 'menu', 'pgback', 'pgfwd']
const CUSTOM: readonly CustomKey[] = ['HOME', 'REG', 'RUNS', 'LEDG', 'LIVE', 'OOS']

// A pointer click moves focus to the button on mousedown, before the click fires; without holding that
// back, the command line's onBlur runs first and closes its suggestion list, so a CANCEL click cascades
// two steps (close the list, then clear the line) in one press (D12). The sheet and menu rows already
// hold pointer focus back the same way.
function preventPointerFocus(e: MouseEvent) {
  e.preventDefault()
}

function KeyButton({ id, text, name, colour, onKey }: { readonly id: KeyId; readonly text: string; readonly name: string; readonly colour: 'cancel' | 'go'; readonly onKey: (key: KeyId) => void }) {
  return (
    <button type="button" className="key-btn" data-key={id} data-colour={colour} aria-label={name} onMouseDown={preventPointerFocus} onClick={() => onKey(id)}>
      {text}
    </button>
  )
}

export function KeyToolbar({ onKey, keys = detectKeysTable() }: KeyToolbarProps) {
  const mac = keys === 'mac'
  const nameOf = (id: OfficialKey): string => (mac && (id === 'pgback' || id === 'pgfwd') ? MAC_KEY_TOOLBAR_NAMES[id] : KEY_TOOLBAR.keys[id].name)
  return (
    <div className="key-toolbar" role="group" aria-label={KEY_TOOLBAR.label} data-chrome="keys">
      {OFFICIAL.map((id) => (
        <KeyButton key={id} id={id} text={KEY_TOOLBAR.keys[id].text} name={nameOf(id)} colour={id === 'esc' ? 'cancel' : 'go'} onKey={onKey} />
      ))}
      {CUSTOM.map((id) => (
        <KeyButton key={id} id={id} text={id} name={KEY_TOOLBAR.custom[id]} colour="go" onKey={onKey} />
      ))}
      <button type="button" className="key-map-btn" data-key="keymap" aria-label={mac ? MAC_KEYMAP_NAME : KEY_TOOLBAR.keymap} onMouseDown={preventPointerFocus} onClick={() => onKey('keymap')}>
        <span aria-hidden="true">{KEY_TOOLBAR.keymapGlyph}</span>
      </button>
    </div>
  )
}
