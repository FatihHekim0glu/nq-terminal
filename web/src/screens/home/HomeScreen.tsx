// HOME on its own in a panel (Shift+Enter HOME, look spec 7.1): the launchpad index. `HOME <GO>`
// itself loads the 2x2 grid (layouts.ts); this panel lists that grid as numbered command lines, then
// the screens that open with Shift+Enter (LIVE, OOS) and a few more. Number <GO> or a link runs the
// line through the command line, like typing it.
import { useMemo } from 'react'
import { requestLine } from '../../chrome/CommandLine.bus'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered } from '../../chrome/PanelChrome.numbers'
import type { LinkGroup } from '../../chrome/WorkspaceLayouts'
import { panelTitle } from '../../chrome/WorkspaceModel'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { findMnemonic, type MnemonicCode } from '../../commands/registry'
import { HOME_LAUNCHPAD } from '../../copy/home'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL } from '../../copy/workspace'
import CommandLink from '../help/CommandLink'
import { layoutFor } from '../layouts/layouts'
import '../../grids/grid.css'
import './home.css'

export interface LaunchLine {
  readonly n: number
  readonly line: string
  readonly code: MnemonicCode
  readonly group: LinkGroup
  readonly section: 'home' | 'more'
}

/** The HOME grid's panels as command lines in reading order, then the other screens, numbered. */
export function launchpadLines(): LaunchLine[] {
  const home = layoutFor('HOME').panels
  const order: readonly MnemonicCode[] = ['GP', 'MON', 'EQ', 'REG']
  const grid = order.flatMap((code) => home.filter((p) => p.code === code))
  const lines = [
    ...grid.map((p) => ({ line: panelTitle(p), code: p.code, group: p.group, section: 'home' as const })),
    ...HOME_LAUNCHPAD.moreLines.map((code) => ({ line: code, code, group: '-' as const, section: 'more' as const })),
  ]
  return lines.map((l, i) => ({ ...l, n: i + 1 }))
}

function GroupCell({ group }: { readonly group: LinkGroup }) {
  return <td>{group === '-' ? HOME_LAUNCHPAD.groupNone : `[${group}]`}</td>
}

function Rows({ lines, section, heading }: { readonly lines: readonly LaunchLine[]; readonly section: LaunchLine['section']; readonly heading: string }) {
  return (
    <>
      <tr className="group-row">
        <td colSpan={4}>{heading}</td>
      </tr>
      {lines
        .filter((l) => l.section === section)
        .map((l) => (
          <tr key={l.n}>
            <td className="ix"><span className="hot">{`${l.n})`}</span></td>
            <td><CommandLink text={`{${l.line} <GO>}`} /></td>
            <td className="name">{findMnemonic(l.code)?.screen ?? l.code}</td>
            <GroupCell group={l.group} />
          </tr>
        ))}
    </>
  )
}

export default function HomeScreen(_props: ScreenProps) {
  const actions = usePanelActions()
  const lines = useMemo(launchpadLines, [])
  useNumbered(actions.panelId, 'launchpad', lines.map((l) => ({ n: l.n, label: l.line, run: () => requestLine(l.line) })))
  const c = HOME_LAUNCHPAD.columns
  return (
    <>
      <FunctionBar
        panelId={actions.panelId}
        title={HOME_LAUNCHPAD.title}
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
      <div className="home-launch">
        <p className="home-launch-intro">{HOME_LAUNCHPAD.intro}</p>
        <table className="nqt-grid">
          <caption className="sr-only">{HOME_LAUNCHPAD.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{c.number}</th>
              <th scope="col">{c.command}</th>
              <th scope="col">{c.screen}</th>
              <th scope="col">{c.group}</th>
            </tr>
          </thead>
          <tbody>
            <Rows lines={lines} section="home" heading={HOME_LAUNCHPAD.sections.home} />
            <Rows lines={lines} section="more" heading={HOME_LAUNCHPAD.sections.more} />
          </tbody>
        </table>
      </div>
    </>
  )
}
