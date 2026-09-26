// The labelled placeholder an unbuilt screen shows (TASKS 4.4), drawn the way a built screen will
// be (look spec 4.3, 4.4, 4.8): the red function bar with `96) Actions` and the screen title,
// the tab strip where screens share a panel (EQ, DD, RET, RR, MRET), and a grid naming the screen,
// its build phase and the context and argument the command gave it. The grid fills the panel at the
// terminal's 20px row pitch, so the layout shows its real density before the screen exists.
import type { CommandArgs } from '../commands/parser'
import type { MnemonicCode, MnemonicDef } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, PLACEHOLDER, TAB_SETS, fillCopy } from '../copy/workspace'
import FunctionBar from './FunctionBar'
import { usePanelActions } from './PanelChrome.actions'
import TabStrip from './TabStrip'
import { SCREEN_PHASES } from './WorkspaceLayouts'
import '../grids/grid.css'

export interface WorkspacePlaceholderProps {
  readonly panelId: string
  readonly def: MnemonicDef
  readonly context: ResolvedContext | null
  readonly args: CommandArgs
}

/** Enough rows to fill a maximised panel at 1080p. */
export const PLACEHOLDER_ROWS = 48

function plan(def: MnemonicDef): string {
  if (def.priority === 'P1') return PLACEHOLDER.P1
  if (def.priority === 'P2') return PLACEHOLDER.P2
  return fillCopy(PLACEHOLDER.P0, { phase: SCREEN_PHASES[def.code] ?? '?' })
}

function infoRows(def: MnemonicDef, context: ResolvedContext | null, args: CommandArgs): Array<readonly [string, string]> {
  const argument = args.date ?? args.timeframe
  return [
    [PLACEHOLDER.rowScreen, fillCopy(PLACEHOLDER.heading, { code: def.code, screen: def.screen })],
    [PLACEHOLDER.rowStatus, PLACEHOLDER.status],
    [PLACEHOLDER.rowBuild, plan(def)],
    [PLACEHOLDER.rowContext, context ? `${context.value} (${context.kind})` : PLACEHOLDER.none],
    ...(argument ? [[PLACEHOLDER.rowArgument, argument] as const] : []),
  ]
}

const ANALYTICS = TAB_SETS.analytics
const ANALYTICS_CODES = Object.keys(ANALYTICS.tabs) as Array<keyof typeof ANALYTICS.tabs>

function isAnalytics(code: MnemonicCode): code is keyof typeof ANALYTICS.tabs {
  return (ANALYTICS_CODES as readonly string[]).includes(code)
}

export default function WorkspacePlaceholder({ panelId, def, context, args }: WorkspacePlaceholderProps) {
  const actions = usePanelActions()
  const rows = infoRows(def, context, args)
  const filler = Math.max(0, PLACEHOLDER_ROWS - rows.length)
  return (
    <div className="ws-placeholder" data-placeholder={def.code}>
      <FunctionBar
        panelId={panelId}
        title={def.screen}
        items={[
          {
            n: FUNCTION_NUMBERS.actions,
            label: FUNCTION_BAR.actions,
            menu: [
              { label: PANEL.related, onSelect: () => actions.related() },
              { label: PANEL.back, onSelect: () => actions.back() },
              { label: PANEL.forward, onSelect: () => actions.forward() },
            ],
          },
        ]}
      />
      {isAnalytics(def.code) ? (
        <TabStrip
          panelId={panelId}
          label={ANALYTICS.label}
          tabs={ANALYTICS_CODES.map((code) => ({ id: code, label: ANALYTICS.tabs[code] }))}
          selected={def.code}
          onSelect={(code) => {
            if (code !== def.code && isAnalytics(code as MnemonicCode)) actions.open(code as MnemonicCode)
          }}
        />
      ) : null}
      <table className="nqt-grid">
        <caption className="sr-only">{fillCopy(PLACEHOLDER.gridCaption, { code: def.code })}</caption>
        <colgroup>
          <col className="ws-col-item" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{PLACEHOLDER.itemColumn}</th>
            <th scope="col">{PLACEHOLDER.valueColumn}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([item, value]) => (
            <tr key={item}>
              <td className="name">{item}</td>
              <td title={value}>{value}</td>
            </tr>
          ))}
          {Array.from({ length: filler }, (_, i) => (
            <tr key={`filler-${i}`} aria-hidden="true">
              <td className="muted">{PLACEHOLDER.missing}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
