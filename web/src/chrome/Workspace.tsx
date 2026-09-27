// Workspace (UI_SPEC sections 2, 5 and 8; look spec 4.1, 4.3, 4.7, 7.1): dockview panels with a
// default layout per screen, separated by 2px black gutters with no panel borders.
// - Each dockview group's tab strip is hidden; PanelChrome is the title bar, so each panel is one Tab
//   stop (dockview's keyboard support is not relied on) and Tab moves between panels.
// - Layouts are fixed: the sashes between panels do not drag (Workspace.css), because dragging a
//   sash has no keyboard or single-pointer equivalent (WCAG 2.1.1, 2.5.7). Commands change the
//   panel set; WorkspaceController saves that per screen.
// - Panels are numbered in reading order (`1-GP`); the focused one carries the 1px focus line; the
//   related functions menu dims only its own panel; back and forward walk each panel's history.
// - dockview's own live announcements are off: the command line's message is the one voice.
// This file is the React shell; what commands and focus do lives in WorkspaceController.
import { DockviewReact, type DockviewTheme, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { Suspense, createContext, useContext, useEffect, useImperativeHandle, useMemo, useRef, type Ref, type RefObject } from 'react'
import { useStore } from 'zustand'
import { findMnemonic, type MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { WORKSPACE } from '../copy/workspace'
import { useLayouts, type LayoutsStore } from '../state/layouts'
import { useLinkGroups, type LinkGroupsStore } from '../state/linkGroups'
import { registerNumbered } from './NumberedActions'
import PanelChrome from './PanelChrome'
import { PanelActionsContext, type PanelActions } from './PanelChrome.actions'
import { NumberingContext } from './PanelChrome.numbers'
import RelatedMenu from './RelatedMenu'
import ScreenBoundary from './ScreenBoundary'
import { createWorkspaceController, type ControllerEnv, type FocusedPanel, type RunTarget, type WorkspaceController } from './WorkspaceController'
import { PANEL_COMPONENT, effectiveContext, panelSubject, panelTitle, sanitiseParams } from './WorkspaceModel'
import WorkspacePlaceholder from './WorkspacePlaceholder'
import { createWorkspaceView, type WorkspaceView } from './WorkspaceView'
import { BUILT_SCREENS, type ScreenRegistry } from './WorkspaceScreens'
import type { ParsedCommand } from '../commands/parser'
import './Workspace.css'

export type { FocusedPanel, RunTarget } from './WorkspaceController'

export interface WorkspaceHandle {
  run(command: ParsedCommand, target: RunTarget): void
  /** Focus the panel the user last focused. False when there is none. */
  focusPanel(): boolean
  /** Focus panel N in reading order (Alt+N). False when there is no such panel. */
  focusPanelNumber(n: number): boolean
  /** The focused panel's context as it is now: the command line's fallback, read at parse time. */
  focusedContext(): ResolvedContext | null
  /** BACK in a panel's own history (End, the `<` button). False when there is nothing behind. */
  goBack(panelId: string): boolean
  /** Forward in a panel's own history (the `>` button). False when there is nothing ahead. */
  goForward(panelId: string): boolean
  /** Open the related functions menu (MENU) in a panel, by default the focused one. */
  openRelatedMenu(panelId?: string): boolean
  /** Close the related functions menu wherever it is open. */
  closeRelatedMenu(): void
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

/** 2px black gutters between panels; no panel borders (look spec 4.3). */
export const WORKSPACE_THEME: DockviewTheme = { name: 'nqt', className: 'dockview-theme-nqt', colorScheme: 'dark', gap: 2 }

interface PanelEnv {
  readonly screens: ScreenRegistry
  readonly linkGroups: LinkGroupsStore
  readonly controller: WorkspaceController | null
  readonly view: WorkspaceView
}

const PanelEnvContext = createContext<PanelEnv>({ screens: BUILT_SCREENS, linkGroups: useLinkGroups, controller: null, view: createWorkspaceView() })

function UnreadablePanel({ id }: { readonly id: string }) {
  return (
    <PanelChrome panelId={id} title={WORKSPACE.unreadableTitle} group="-" landmark={false}>
      <p className="ws-placeholder-plan">{WORKSPACE.unreadable}</p>
    </PanelChrome>
  )
}

function usePanelActionsFor(controller: WorkspaceController | null, id: string): PanelActions {
  return useMemo(
    () => ({
      panelId: id,
      related: () => controller?.openRelatedMenu(id) ?? false,
      back: () => controller?.goBack(id) ?? false,
      forward: () => controller?.goForward(id) ?? false,
      open: (code: MnemonicCode) => controller?.openInPanel(id, code) ?? false,
    }),
    [controller, id],
  )
}

function ScreenPanel(props: IDockviewPanelProps<Record<string, unknown>>) {
  const { screens, linkGroups, controller, view } = useContext(PanelEnvContext)
  const id = props.api.id
  const params = sanitiseParams(props.params)
  const groupContext = useStore(linkGroups, (s) => (params && params.group !== '-' ? s.contexts[params.group] : null))
  const number = useStore(view, (s) => s.order.indexOf(id) + 1)
  const focused = useStore(view, (s) => s.focused === id)
  const menuOpen = useStore(view, (s) => s.menu === id)
  const maximised = useStore(view, (s) => s.maximised === id)
  const actions = usePanelActionsFor(controller, id)
  const def = params ? findMnemonic(params.code) : undefined
  const context = params ? effectiveContext(params, groupContext) : null
  const title = params && def ? panelTitle({ ...params, context }) : WORKSPACE.unreadableTitle
  // dockview names the group region after the panel title; keep it equal to the header.
  useEffect(() => {
    if (props.api.title !== title) props.api.setTitle(title)
  }, [props.api, title])
  if (!params || !def) return <UnreadablePanel id={id} />
  const Screen = screens[params.code]
  const overlay = menuOpen ? (
    <RelatedMenu
      panelId={id}
      context={context}
      onOpen={(code) => actions.open(code)}
      onClose={() => {
        controller?.closeRelatedMenu()
        controller?.focusPanelNumber(number)
      }}
    />
  ) : null
  return (
    <PanelActionsContext value={actions}>
      <PanelChrome
        panelId={id}
        number={number > 0 ? number : undefined}
        code={params.code}
        title={title}
        subject={panelSubject({ ...params, context })}
        group={params.group}
        focused={focused}
        maximised={maximised}
        onToggleMaximise={() => controller?.toggleMaximise(id)}
        onRelated={() => actions.related()}
        onBack={() => actions.back()}
        onForward={() => actions.forward()}
        overlay={overlay}
        landmark={false}
      >
        {Screen ? (
          <ScreenBoundary resetKey={`${params.code}:${context?.kind ?? ''}:${context?.value ?? ''}`}>
            <Suspense fallback={<p className="ws-empty">{WORKSPACE.loadingScreen}</p>}>
              <Screen params={params} context={context} />
            </Suspense>
          </ScreenBoundary>
        ) : (
          <WorkspacePlaceholder panelId={id} def={def} context={context} args={params.args} />
        )}
      </PanelChrome>
    </PanelActionsContext>
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
    focusPanelNumber: controller.focusPanelNumber,
    focusedContext: controller.focusedContext,
    goBack: controller.goBack,
    goForward: controller.goForward,
    openRelatedMenu: controller.openRelatedMenu,
    closeRelatedMenu: controller.closeRelatedMenu,
  }))
  const env = { screens: props.screens ?? BUILT_SCREENS, linkGroups: props.linkGroups ?? useLinkGroups, controller, view: controller.view }
  return (
    <main className="workspace nqt-workspace" aria-label={WORKSPACE.label} ref={rootRef} onFocus={(e) => controller.onFocusIn(e.target)}>
      <NumberingContext value={registerNumbered}>
        <PanelEnvContext value={env}>
          <DockviewReact
            className="nqt-dock"
            theme={WORKSPACE_THEME}
            components={COMPONENTS}
            watermarkComponent={Watermark}
            disableFloatingGroups
            disableDnd
            announcements={false}
            onReady={(event) => controller.onReady(event.api)}
          />
        </PanelEnvContext>
      </NumberingContext>
    </main>
  )
}
