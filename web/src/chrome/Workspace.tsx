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
// - Named workspaces (SAVE, LOAD) are methods on the handle; the command line only supplies the parser.
// - GRAB <GO> is grab() on the handle and each panel's Options menu lists the same image export
//   (panelExport.ts, imported by this file alone); the grab code itself loads only when someone asks.
// This file is the React shell; what commands, focus and workspaces do lives in WorkspaceController.
import { QueryClientContext } from '@tanstack/react-query'
import { DockviewReact, type DockviewTheme, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { Suspense, createContext, useContext, useEffect, useImperativeHandle, useMemo, useRef, type Ref, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useStore } from 'zustand'
import type { LineResult } from '../commands/line'
import { findMnemonic, type MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { WORKSPACE } from '../copy/workspace'
import { useLayouts, type LayoutsStore } from '../state/layouts'
import { useLinkGroups, type LinkGroupsStore } from '../state/linkGroups'
import { useWorkspaces, type WorkspacesStore } from '../state/workspaces'
import { copyLinkEntries } from './copyLink'
import { markWorkspaceGone, markWorkspaceReady } from './deepLink'
import { registerNumbered } from './NumberedActions'
import PanelChrome from './PanelChrome'
import { PanelActionsContext, type PanelActions } from './PanelChrome.actions'
import { NumberingContext } from './PanelChrome.numbers'
import { panelExportEntries, panelTarget, readHealth, runGrab, type GrabTarget } from './panelExport'
import RelatedMenu from './RelatedMenu'
import ScreenBoundary from './ScreenBoundary'
import { createWorkspaceController, type ControllerEnv, type FocusedPanel, type RunTarget, type ShownLayout, type WorkspaceController } from './WorkspaceController'
import { PANEL_COMPONENT, effectiveContext, panelSubject, panelTitle, sanitiseParams } from './WorkspaceModel'
import type { RunPreview } from './WorkspacePreview'
import type { Recipe } from './WorkspaceRecipe'
import WorkspacePlaceholder from './WorkspacePlaceholder'
import { createWorkspaceView, type WorkspaceView } from './WorkspaceView'
import { BUILT_SCREENS, type ScreenRegistry } from './WorkspaceScreens'
import type { ParsedCommand } from '../commands/parser'
import './Workspace.css'

export type { FocusedPanel, RunTarget, ShownLayout } from './WorkspaceController'
export type { RunPreview } from './WorkspacePreview'

export interface WorkspaceHandle {
  /** False when the Workspace has no dockview api yet (a command typed before it finished loading). */
  run(command: ParsedCommand, target: RunTarget): boolean
  /** What run(command, target) would do, with no side effects. Null with no dockview api yet. */
  preview(command: ParsedCommand, target: RunTarget): RunPreview | null
  /** Focus the panel the user last focused. False when there is none. */
  focusPanel(): boolean
  /** Focus panel N in reading order (Alt+N). False when there is no such panel. */
  focusPanelNumber(n: number): boolean
  /** Focus the panel showing mnemonic `code` (U20: F1 pressed again, or held, while a HELP panel is
   * already open focuses it instead of adding another). False when none shows it. */
  focusPanelShowing(code: MnemonicCode): boolean
  /** The focused panel's context as it is now: the command line's fallback, read at parse time. */
  focusedContext(): ResolvedContext | null
  /** BACK in a panel's own history (End, the `<` button). False when there is nothing behind. */
  goBack(panelId: string): boolean
  /** Forward in a panel's own history (the `>` button). False when there is nothing ahead. */
  goForward(panelId: string): boolean
  /** What panel `panelId` shows right now (U10: the message after goBack/goForward names where it
   * landed, not the stale panel the chrome had focused before the move). Null when it does not exist. */
  shownIn(panelId: string): { readonly code: MnemonicCode; readonly context: ResolvedContext | null } | null
  /** GRAB <GO>: save the focused panel's charts as an image (`file`, the default) or copy it (`clipboard`),
   * with the panel's provenance as a caption. False, with nothing done, when no panel is focused; true once
   * the grab has been started (the message line then says how it went). Makes no request. */
  grab(target?: GrabTarget): boolean
  /** Open the related functions menu (MENU) in a panel, by default the focused one. */
  openRelatedMenu(panelId?: string): boolean
  /** Close the related functions menu wherever it is open. */
  closeRelatedMenu(): void
  /** Reset the layout on screen ('reset'), or report there is nothing to reset ('default'). A screen goes
   * back to its default layout; a workspace goes back to the panels it was saved or loaded with and stays
   * the owner, and no saved screen layout is touched. */
  resetLayout(): 'reset' | 'default' | null
  /** Undo the last layout change. The screen it restored, or null when there was nothing to undo. The
   * layout's owner (a screen or a named workspace) comes back with the panels. */
  undo(): MnemonicCode | null
  /** The recipe of the panels on screen, with the workspace `name` then owning the layout, unedited.
   * Null (nothing changes) for a bad name or when the panels cannot be written as command lines. */
  saveRecipe(name: string): Recipe | null
  /** Rebuild the panels from a recipe whose lines were parsed into `commands`, panel for panel. False,
   * with nothing changed, when they do not fit. Snapshots undo first. */
  loadRecipe(name: string, recipe: Recipe, commands: readonly ParsedCommand[]): boolean
  /** SAVE NAME: keep the panels on screen as a named workspace. The message to show: WORKSPACES.saved,
   * or badName, full or notKept. A name is trimmed and put in capitals. */
  saveWorkspace(name: string): string
  /** LOAD NAME: parse every line of the saved workspace with `parse`; if all are screen commands rebuild
   * the panels, else change nothing. The message to show: WORKSPACES.loaded, missing or lineFailed. */
  loadWorkspace(name: string, parse: (line: string) => LineResult): string
}

export interface WorkspaceProps {
  readonly ref?: Ref<WorkspaceHandle>
  readonly initialScreen?: MnemonicCode
  readonly screens?: ScreenRegistry
  readonly layouts?: LayoutsStore
  readonly linkGroups?: LinkGroupsStore
  readonly workspaces?: WorkspacesStore
  readonly onFocusedPanelChange?: (panel: FocusedPanel | null) => void
  readonly onLayoutChange?: (shown: ShownLayout) => void
  readonly onLayoutDropped?: (code: MnemonicCode) => void
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
  // The cache the status line fills, read (never fetched) when Grab as image is chosen; absent in a bare Workspace.
  const client = useContext(QueryClientContext)
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
        // G05: closeRelatedMenu() only patches the view store; React 18 batches the re-render that
        // unmounts the overlay until this handler returns. Without flushSync, focusPanelNumber below
        // runs syncRoving while the overlay (data-roving-overlay) is still mounted, so it focuses the
        // overlay's own first menuitem, which then vanishes a moment later and drops focus to <body>.
        flushSync(() => controller?.closeRelatedMenu())
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
        extraOptions={() => [
          ...panelExportEntries(panelTarget(id, params.code, number, params.group), () => readHealth(client)),
          ...copyLinkEntries(title),
        ]}
        overlay={overlay}
        landmark={false}
      >
        {Screen ? (
          <ScreenBoundary
            resetKey={`${params.code}:${context?.kind ?? ''}:${context?.value ?? ''}:${params.args.date ?? ''}:${params.args.timeframe ?? ''}`}
          >
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
  const linkGroups = props.linkGroups ?? useLinkGroups
  env.current = {
    initialScreen: props.initialScreen ?? 'HOME',
    layouts: props.layouts ?? useLayouts,
    linkGroups,
    workspaces: props.workspaces ?? useWorkspaces,
    root: () => rootRef.current,
    onFocusedPanelChange: props.onFocusedPanelChange,
    onLayoutChange: props.onLayoutChange,
    onLayoutDropped: props.onLayoutDropped,
  }
  const controller = useRef<WorkspaceController | null>(null)
  controller.current ??= createWorkspaceController(() => env.current as ControllerEnv)
  // A link group can be retargeted from outside a run() (the nav toolbar's own context control, look
  // spec 4.2): the addressed panel's reported context would otherwise go stale until the next command.
  useEffect(
    () =>
      linkGroups.subscribe((state, prev) => {
        if (state.contexts !== prev.contexts) controller.current?.refreshFocused()
      }),
    [linkGroups],
  )
  return controller.current
}

export default function Workspace(props: WorkspaceProps) {
  const rootRef = useRef<HTMLElement>(null)
  const client = useContext(QueryClientContext)
  // The panel the command line addresses, as the controller last reported it: what GRAB <GO> grabs.
  const focusedRef = useRef<FocusedPanel | null>(null)
  const controller = useController(
    {
      ...props,
      onFocusedPanelChange: (panel) => {
        focusedRef.current = panel
        props.onFocusedPanelChange?.(panel)
      },
    },
    rootRef,
  )
  // Terminal links wait for the workspace (deepLink.ts): ready from onReady until this unmounts.
  useEffect(() => () => markWorkspaceGone(), [])
  useImperativeHandle(props.ref, () => ({
    run: controller.run,
    preview: controller.preview,
    focusPanel: controller.focusPanel,
    focusPanelNumber: controller.focusPanelNumber,
    focusPanelShowing: controller.focusPanelShowing,
    focusedContext: controller.focusedContext,
    grab: (target = 'file') => {
      const panel = focusedRef.current
      if (!panel) return false
      void runGrab(panelTarget(panel.panelId, panel.params.code, panel.number, panel.params.group), readHealth(client), target)
      return true
    },
    goBack: controller.goBack,
    goForward: controller.goForward,
    shownIn: controller.shownIn,
    openRelatedMenu: controller.openRelatedMenu,
    closeRelatedMenu: controller.closeRelatedMenu,
    resetLayout: controller.resetLayout,
    undo: controller.undo,
    saveRecipe: controller.saveRecipe,
    loadRecipe: controller.loadRecipe,
    saveWorkspace: controller.saveWorkspace,
    loadWorkspace: controller.loadWorkspace,
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
            onReady={(event) => {
              controller.onReady(event.api)
              markWorkspaceReady()
            }}
          />
        </PanelEnvContext>
      </NumberingContext>
    </main>
  )
}
