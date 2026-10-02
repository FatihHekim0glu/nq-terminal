// The autocomplete sheet (spec 4.2): hangs from the command box, grouped under uppercase amber headings
// (the first carrying the italic `<UP ARROW> to hide` hint), two columns per row: the mnemonic or
// ticker in white, the description in grey with the typed letters in bold white. A group shows 6 rows
// (9 when it is the only one), then a "More ..." row that opens the rest. cmdk supplies the listbox,
// the options and the arrow keys; rows keep role="option".
import { Command } from 'cmdk'
import type { SheetGroup } from '../commands/suggest'
import { COMMAND_MENUS, SUGGESTION_GROUPS, SUGGESTION_MORE } from '../copy/menus'
import { MORE_PREFIX } from './CommandLine.state'

export interface SheetProps {
  readonly groups: readonly SheetGroup[]
  /** The token being typed, matched in each description. */
  readonly typed: string
  readonly onChoose: (value: string) => void
  readonly listRef: (node: HTMLDivElement | null) => void
}

/** The description with the first match of `typed` in bold. */
function Detail({ text, typed }: { readonly text: string; readonly typed: string }) {
  const at = typed === '' ? -1 : text.toLowerCase().indexOf(typed.toLowerCase())
  if (at < 0) return <span className="det">{text}</span>
  return (
    <span className="det">
      {text.slice(0, at)}
      <b>{text.slice(at, at + typed.length)}</b>
      {text.slice(at + typed.length)}
    </span>
  )
}

function Heading({ group, first }: { readonly group: SheetGroup['group']; readonly first: boolean }) {
  return (
    <span className="grp-head">
      <span>{SUGGESTION_GROUPS[group]}</span>
      {first ? <i className="grp-hint">{COMMAND_MENUS.hideHint}</i> : null}
    </span>
  )
}

export function Sheet({ groups, typed, onChoose, listRef }: SheetProps) {
  return (
    <Command.List ref={listRef} className="cmd-list" label={COMMAND_MENUS.suggestionsLabel} onMouseDown={(e) => e.preventDefault()}>
      {groups.map(({ group, items, more }, i) => (
        <Command.Group key={group} heading={<Heading group={group} first={i === 0} />}>
          {items.map((s) => (
            <Command.Item key={s.value} value={s.value.trim()} onSelect={() => onChoose(s.value)} data-group={s.group}>
              <span className="lbl">{s.label}</span>
              <Detail text={s.detail} typed={typed} />
            </Command.Item>
          ))}
          {more > 0 ? (
            <Command.Item key={`${MORE_PREFIX}${group}`} value={`${MORE_PREFIX}${group}`} onSelect={() => onChoose(`${MORE_PREFIX}${group}`)} className="more">
              <i>{SUGGESTION_MORE[group]}</i>
            </Command.Item>
          ) : null}
        </Command.Group>
      ))}
    </Command.List>
  )
}
