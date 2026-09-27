// The HELP contents rail (look spec 7.12): white group headings with right-aligned counts; under
// Mnemonics the numbered amber items (the same numbers as the index, Number <GO> targets). The
// selected heading or item carries aria-current and the selection navy.
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import type { MnemonicCode, MnemonicDef } from '../../commands/registry'
import { HELP } from '../../copy/help'

const roving = { [ROVING_ATTR]: '' }

export type SectionId = 'mnemonics' | 'keys' | 'links' | 'keyboard' | 'licences'

export interface TocEntry {
  readonly id: SectionId
  readonly label: string
  readonly count: number | null
}

/** What the rail has selected: a group heading, or one numbered mnemonic under Mnemonics. */
export type TocSelection = { readonly kind: 'section'; readonly id: SectionId } | { readonly kind: 'item'; readonly code: MnemonicCode }

export interface HelpTocProps {
  readonly entries: readonly TocEntry[]
  readonly mnemonics: readonly MnemonicDef[]
  readonly selected: TocSelection
  readonly onSection: (id: SectionId) => void
  readonly onItem: (code: MnemonicCode) => void
}

const current = (on: boolean) => (on ? 'true' : undefined)

function TocItems({ mnemonics, selected, onItem }: Pick<HelpTocProps, 'mnemonics' | 'selected' | 'onItem'>) {
  return (
    <ul className="toc-items" aria-label={HELP.mnemonicsHeading}>
      {mnemonics.map((m, i) => (
        <li key={m.code}>
          <button type="button" className="toc-item" aria-current={current(selected.kind === 'item' && selected.code === m.code)} onClick={() => onItem(m.code)} {...roving}>
            <span className="ix"><span className="hot">{`${i + 1})`}</span></span> <span>{m.code}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function HelpToc({ entries, mnemonics, selected, onSection, onItem }: HelpTocProps) {
  return (
    <nav className="help-toc" aria-label={HELP.tocLabel}>
      <ul>
        {entries.map((e) => (
          <li key={e.id} className="toc-group">
            <button type="button" aria-current={current(selected.kind === 'section' && selected.id === e.id)} onClick={() => onSection(e.id)} {...roving}>
              <span>{e.label}</span>
              {e.count !== null ? <span className="count">{e.count}</span> : null}
            </button>
            {e.id === 'mnemonics' ? <TocItems mnemonics={mnemonics} selected={selected} onItem={onItem} /> : null}
          </li>
        ))}
      </ul>
    </nav>
  )
}
