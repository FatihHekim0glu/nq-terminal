// Analytics tear sheet (TASKS 6.4; UI_SPEC section 7; look spec 7.5): one panel, five tabs, EQ, DD,
// RET, RR and MRET, each opened by its mnemonic. Model: the Performance function of a portfolio
// analytics screen, rebuilt from tokens: the red function bar titled after the tab, trapezoid tabs
// numbered 1) to 5), an amber parameter row, the KPI row, the tab's charts, and for a run its trades,
// costs and exposure panels. `98) Export` saves the open tab's series as CSV (tearExport.ts). The
// context is the panel's run or hypothesis; anything else is refused
// in the panel. Inside a workspace a tab opens its own function in the panel (so End walks back
// through the tabs); outside one the tab switches in place.
import { useId, useState } from 'react'
import { requestLine } from '../../chrome/CommandLine.bus'
import { ExportSlotProvider, useExportSlot } from '../../chrome/exportSource'
import { AmberField } from '../../chrome/Field'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions, type PanelActions } from '../../chrome/PanelChrome.actions'
import TabStrip from '../../chrome/TabStrip'
import type { MnemonicCode } from '../../commands/registry'
import type { ResolvedContext } from '../../commands/types'
import { TEAR, TEAR_BAR } from '../../copy/tear'
import { FUNCTION_NUMBERS, fillCopy } from '../../copy/workspace'
import TearBody from './TearBody'
import type { TearTarget } from './tearQueries'
import './tear.css'

export const TEAR_CODES = ['EQ', 'DD', 'RET', 'RR', 'MRET'] as const
export type TearCode = (typeof TEAR_CODES)[number]

export function isTearCode(code: string): code is TearCode {
  return (TEAR_CODES as readonly string[]).includes(code)
}

/** The run or hypothesis the tear sheet shows; null for no context or another kind. */
export function tearTarget(context: ResolvedContext | null): TearTarget | null {
  if (!context || (context.kind !== 'run' && context.kind !== 'hypothesis')) return null
  return context.value.trim() === '' ? null : { kind: context.kind, name: context.value }
}

/** The open tab: the panel's mnemonic, or the tab chosen in place since that mnemonic was set. */
function useTab(code: MnemonicCode): readonly [TearCode, (next: TearCode) => void] {
  const initial: TearCode = isTearCode(code) ? code : 'EQ'
  const [state, setState] = useState({ from: initial, tab: initial })
  if (state.from !== initial) setState({ from: initial, tab: initial })
  const tab = state.from === initial ? state.tab : initial
  return [tab, (next) => setState({ from: initial, tab: next })]
}

function barItems(actions: PanelActions, target: TearTarget | null, onExport: () => void) {
  const inspect = target?.kind === 'run'
    ? [{ label: TEAR_BAR.openRun, onSelect: () => actions.open('RUN') }]
    : target?.kind === 'hypothesis'
      ? [{ label: TEAR_BAR.openDes, onSelect: () => actions.open('DES') }]
      : []
  return [
    {
      n: FUNCTION_NUMBERS.actions,
      label: TEAR_BAR.actions,
      menu: [
        ...inspect,
        { label: TEAR_BAR.related, onSelect: () => actions.related() },
        { label: TEAR_BAR.back, onSelect: () => actions.back() },
        { label: TEAR_BAR.forward, onSelect: () => actions.forward() },
      ],
    },
    { n: FUNCTION_NUMBERS.export, label: TEAR_BAR.export, onRun: onExport },
    { n: FUNCTION_NUMBERS.help, label: TEAR_BAR.help, onRun: () => actions.open('HELP') },
  ]
}

/** The amber context field of the red bar (look spec 7.5): Enter opens the typed name on this tab. */
function ContextField({ value, tab }: { readonly value: string; readonly tab: TearCode }) {
  const [text, setText] = useState(value)
  const submit = (typed: string) => {
    const name = typed.trim()
    if (name !== '') requestLine(`${name} ${tab}`)
  }
  return <AmberField label={TEAR.fieldLabel} placeholder={TEAR.fieldPlaceholder} value={text} onChange={setText} onSubmit={submit} width="12em" />
}

function ContextNote({ context }: { readonly context: ResolvedContext | null }) {
  const text = context
    ? fillCopy(TEAR.wrongContext, { kind: context.kind, value: context.value })
    : fillCopy(TEAR.needContext, { example: TEAR.needContextExample })
  return <p className="tear-note" role="status">{text}</p>
}

export default function TearSheet({ params, context }: ScreenProps) {
  const actions = usePanelActions()
  const panelId = actions.panelId || 'tear'
  const [tab, setTab] = useTab(params.code)
  const target = tearTarget(context)
  const viewId = useId()
  const slot = useExportSlot()
  const select = (id: string) => {
    if (!isTearCode(id) || id === tab) return
    if (!actions.open(id)) setTab(id)
  }
  return (
    <ExportSlotProvider slot={slot}>
      <div className="tear">
        <FunctionBar
          panelId={panelId}
          title={TEAR.titles[tab]}
          field={<ContextField key={target?.name ?? ''} value={target?.name ?? ''} tab={tab} />}
          items={barItems(actions, target, () => slot.run())}
        />
        <TabStrip
          panelId={panelId}
          label={TEAR.tabsLabel}
          tabs={TEAR_CODES.map((code) => ({ id: code, label: TEAR.tabs[code] }))}
          selected={tab}
          onSelect={select}
          controls={viewId}
        />
        <div id={viewId} className="tear-main" role="tabpanel" aria-label={TEAR.tabs[tab]}>
          {target ? <TearBody target={target} tab={tab} link={params.group} /> : <ContextNote context={context} />}
        </div>
      </div>
    </ExportSlotProvider>
  )
}
