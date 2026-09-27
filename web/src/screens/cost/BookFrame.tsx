// Shared frame of the P1 screens COST, BLK, EXPO and SEAL (TASKS 9.4; look spec 4.4 and 7): the red
// function bar with the amber context field (Enter runs `<text> <MNEM>`), `96) Actions`, `98) Export`
// when there is something to save, `99) Help`, `Page n/m` and the white title; the route that tells a
// sealed-window confirmation from a registry hypothesis before either is asked for (as DES does); and
// the loading and error lines, which name what is missing. Screens are read only: every request is a GET.
import { useState, type ReactNode } from 'react'
import type { ApiError } from '../../api/client'
import { useConfirmations } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { requestLine } from '../../chrome/CommandLine.bus'
import { AmberField } from '../../chrome/Field'
import FunctionBar, { type MenuEntry } from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { PanelPage } from '../../chrome/PanelChrome.page'
import { BOOKS } from '../../copy/books'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import { Inline } from '../des/DesMarkdown'
import './books.css'

export interface BookBarProps {
  readonly title: string
  /** The mnemonic the amber field runs (`<text> COST`). */
  readonly mnemonic: string
  readonly fieldLabel: string
  readonly placeholder: string
  readonly current: string
  readonly helpLine: string
  readonly page: PanelPage | null
  readonly onExport?: () => void
  /** Extra rows for 96) Actions, after Related, Back and Forward. */
  readonly actions?: readonly MenuEntry[]
}

export function BookBar({ title, mnemonic, fieldLabel, placeholder, current, helpLine, page, onExport, actions = [] }: BookBarProps) {
  const panel = usePanelActions()
  const [text, setText] = useState(current)
  return (
    <FunctionBar
      panelId={panel.panelId}
      title={title}
      page={page ?? undefined}
      field={
        <AmberField
          label={fieldLabel}
          value={text}
          placeholder={placeholder}
          onChange={setText}
          onSubmit={(v) => (v.trim() ? requestLine(`${v.trim()} ${mnemonic}`) : undefined)}
          width="240px"
        />
      }
      items={[
        {
          n: FUNCTION_NUMBERS.actions,
          label: FUNCTION_BAR.actions,
          menu: [
            { label: PANEL.related, onSelect: () => panel.related() },
            { label: PANEL.back, onSelect: () => panel.back() },
            { label: PANEL.forward, onSelect: () => panel.forward() },
            ...actions,
          ],
        },
        ...(onExport ? [{ n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: onExport }] : []),
        { n: FUNCTION_NUMBERS.help, label: FUNCTION_BAR.help, onRun: () => requestLine(helpLine) },
      ]}
    />
  )
}

export function Loading({ name }: { readonly name: string }) {
  return <p className="books-status" role="status" aria-busy="true">{fillCopy(BOOKS.loading, { name })}</p>
}

export function Failed({ name, error }: { readonly name: string; readonly error: ApiError | null }) {
  return <p className="books-status books-error" role="alert">{fillCopy(BOOKS.failed, { name, detail: error?.detail ?? '' })}</p>
}

/** What a panel with no usable context shows: how to give one, with runnable examples. */
export function EmptyGuide({ text }: { readonly text: string }) {
  return <p className="books-status"><Inline text={text} /></p>
}

export type Confirmation = Schemas['Confirmation']

export interface HypothesisRouteProps {
  readonly name: string
  /** The name is a sealed-window confirmation. */
  readonly confirmation: (conf: Confirmation) => ReactNode
  /** The name is (as far as the confirmation list knows) a registry hypothesis. */
  readonly hypothesis: (name: string) => ReactNode
}

/**
 * Reads the confirmation list first, so a sealed-window confirmation is never asked for as a registry
 * row; without the list it says so and asks for nothing more.
 */
export function HypothesisRoute({ name, confirmation, hypothesis }: HypothesisRouteProps) {
  const confirmations = useConfirmations()
  if (confirmations.isPending) return <Loading name={name} />
  if (confirmations.isError) {
    return <p className="books-status books-error" role="alert">{fillCopy(BOOKS.confirmationsFailed, { name, detail: confirmations.error.detail })}</p>
  }
  const conf = confirmations.data.find((c) => c.name === name)
  return <>{conf ? confirmation(conf) : hypothesis(name)}</>
}
