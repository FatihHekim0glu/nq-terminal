// Workspace (UI_SPEC sections 2, 5 and 8): dockview panels with a default layout per screen.
// - Each dockview group's tab strip is hidden; PanelChrome is the 28px header, so each panel is one
//   Tab stop (dockview's keyboard support is not relied on) and Tab moves between panels.
// - Layouts are fixed: the sashes between panels do not drag (Workspace.css), because dragging a
//   4px sash has no keyboard or single-pointer equivalent (WCAG 2.1.1, 2.5.7). Commands change the
//   panel set; WorkspaceController saves that per screen.
// - dockview's own live announcements are off: the command line's status message is the one voice.
// This file is the React shell; what commands and focus do lives in WorkspaceController.
import { DockviewReact, type DockviewTheme, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { Suspense, createContext, useContext, useEffect, useImperativeHandle, useRef, type Ref, type RefObject } from 'react'
import { useStore } from 'zustand'
import { findMnemonic, type MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { WORKSPACE } from '../copy/workspace'
import { useLayouts, type LayoutsStore } from '../state/layouts'
import { useLinkGroups, type LinkGroupsStore } from '../state/linkGroups'
import PanelChrome from './PanelChrome'
import { createWorkspaceController, type ControllerEnv, type FocusedPanel, type RunTarget, type WorkspaceController } from './WorkspaceController'
import { PANEL_COMPONENT, effectiveContext, panelTitle, sanitiseParams } from './WorkspaceModel'
import WorkspacePlaceholder from './WorkspacePlaceholder'
import { BUILT_SCREENS, type ScreenRegistry } from './WorkspaceScreens'
import type { ParsedCommand } from '../commands/parser'
import './Workspace.css'

export type { FocusedPanel, RunTarget } from './WorkspaceController'

export interface WorkspaceHandle {
  run(command: ParsedCommand, target: RunTarget): void
  /** Focus the panel the user last focused. False when there is none. */
  focusPanel(): boolean
  /** The focused panel's context as it is now: the command line's fallback, read at parse time. */
  focusedContext(): ResolvedContext | null
}

export interface WorkspaceProps {
  readonly ref?: Ref<WorkspaceHandle>
  readonly initialScreen?: MnemonicCode
  readonly screens?: ScreenRegistry
  readonly layouts?: LayoutsStore
  readonly linkGroups?: LinkGroupsStore
  readonly onScreenChange?: (code: MnemonicCode) => void
  readonly onFocusedPanelChange?: (panel: FocusedPanel | null) => void
}

const THEME: DockviewTheme = { name: 'nqt', className: 'dockview-theme-nqt', colorScheme: 'dark', gap: 4 }

interface PanelEnv {
  readonly screens: ScreenRegistry
  readonly linkGroups: LinkGroupsStore
}

const PanelEnvContext = createContext<PanelEnv>({ screens: BUILT_SCREENS, linkGroups: useLinkGroups })

function UnreadablePanel({ id }: { readonly id: string }) {
  return (
    <PanelChrome panelId={id} title={WORKSPACE.unreadableTitle} screen="" group="-" landmark={false}>
      <p className="ws-placeholder-plan">{WORKSPACE.unreadable}</p>
    </PanelChrome>
  )
}

function ScreenPanel(props: IDockviewPanelProps<Record<string, unknown>>) {
  const { screens, linkGroups } = useContext(PanelEnvContext)
  const params = sanitiseParams(props.params)
  const groupContext = useStore(linkGroups, (s) => (params && params.group !== '-' ? s.contexts[params.group] : null))
  const def = params ? findMnemonic(params.code) : undefined
  const context = params ? effectiveContext(params, groupContext) : null
  const title = params && def ? panelTitle({ ...params, context }) : WORKSPACE.unreadableTitle
  // dockview names the group region after the panel title; keep it equal to the header.
  useEffect(() => {
    if (props.api.title !== title) props.api.setTitle(title)
  }, [props.api, title])
  if (!params || !def) return <UnreadablePanel id={props.api.id} />
  const Screen = screens[params.code]
  return (
    <PanelChrome panelId={props.api.id} title={title} screen={def.screen} group={params.group} landmark={false}>
      {Screen ? (
        <Suspense fallback={<p className="ws-empty">{WORKSPACE.loadingScreen}</p>}>
          <Screen params={params} context={context} />
        </Suspense>
      ) : (
        <WorkspacePlaceholder def={def} context={context} args={params.args} />
      )}
    </PanelChrome>
  )
}

function Watermark() {
  return <p className="ws-empty">{WORKSPACE.empty}</p>
}

const COMPONENTS = { [PANEL_COMPONENT]: ScreenPanel }

/** One controller per mounted Workspace, reading the latest props through a ref. */
function useController(props: WorkspaceProps, rootRef: RefObject<HTMLElement | null>): WorkspaceController {
  const env = useRef<ControllerEnv | null>(null)
  env.current = {
    initialScreen: props.initialScreen ?? 'HOME',
    layouts: props.layouts ?? useLayouts,
    linkGroups: props.linkGroups ?? useLinkGroups,
    root: () => rootRef.current,
    onScreenChange: props.onScreenChange,
    onFocusedPanelChange: props.onFocusedPanelChange,
  }
  const controller = useRef<WorkspaceController | null>(null)
  controller.current ??= createWorkspaceController(() => env.current as ControllerEnv)
  return controller.current
}

export default function Workspace(props: WorkspaceProps) {
  const rootRef = useRef<HTMLElement>(null)
  const controller = useController(props, rootRef)
  useImperativeHandle(props.ref, () => ({
    run: controller.run,
    focusPanel: controller.focusPanel,
    focusedContext: controller.focusedContext,
  }))
  const env = { screens: props.screens ?? BUILT_SCREENS, linkGroups: props.linkGroups ?? useLinkGroups }
  return (
    <main className="workspace nqt-workspace" aria-label={WORKSPACE.label} ref={rootRef} onFocus={(e) => controller.onFocusIn(e.target)}>
      <PanelEnvContext value={env}>
        <DockviewReact
          className="nqt-dock"
          theme={THEME}
          components={COMPONENTS}
          watermarkComponent={Watermark}
          disableFloatingGroups
          disableDnd
          announcements={false}
          onReady={(event) => controller.onReady(event.api)}
        />
      </PanelEnvContext>
    </main>
  )
}
