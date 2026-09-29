// The terminal frame (spec 4.1), top to bottom: frame strip 37px, key toolbar 32px, nav toolbar 22px,
// command zone 50px, the dockview workspace, the event tape (57px, off by default, decision D4) and the
// 22px status line (decision D7). Data comes only through the typed GET client (src/api) under one
// ApiProvider; link-group contexts and user layouts come from the zustand stores (src/state). The
// Workspace (and dockview with it) loads as its own chunk, so the frame and its safety labels paint
// first. The chrome's keys and buttons run through KeyToolbar.actions.ts; nothing here can place,
// change or withdraw anything. The Workspace reports the layout owner (the screen whose layout the panels
// are arranged under, and whether the viewer has edited it): the frame strip and the status line show it
// with an edited mark, and RESET, UNDO and the <GO> preview row on the command line act on it.
// The provider supervises the backend connection (roadmap 7): the API DOWN strip sits under the header and
// the status line names the time the backend went quiet. The research-record watch (roadmap 16) reads its
// six records only after the first idle moment; its segment, WATCH <GO> and WATCH SEEN <GO> reach the chrome
// through useRecordWatch. The diff and its long copy load with the reader, never with this file.
import { Suspense, lazy, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ApiProvider } from './api/ApiProvider'
import CommandZone from './AppCommandBar'
import type { MnemonicCode } from './commands/registry'
import { displayContext } from './commands/sectors'
import type { ParsedCommand } from './commands/parser'
import type { ResolvedContext } from './commands/types'
import type { CommandLineHandle } from './chrome/CommandLine'
import { useTerminalKeys, type KeyWhere } from './chrome/CommandLine.keys'
import ConnectionStrip from './chrome/ConnectionStrip'
import { LiveEventTape } from './chrome/EventTape.live'
import { toggleTape, useTapeOn } from './chrome/EventTape.store'
import { FrameStrip, type ColourScheme } from './chrome/FrameStrip'
import { KeyToolbar } from './chrome/KeyToolbar'
import { createChromeActions, runGlobalKey, runKey, runNav, type ChromeActions, type ChromeEnv, type ChromeWorkspace } from './chrome/KeyToolbar.actions'
import { KeyMapOverlay } from './chrome/KeyToolbar.overlay'
import { postMessage } from './chrome/MessageLine.store'
import { NavToolbar } from './chrome/NavToolbar'
import { activateNumbered } from './chrome/NumberedActions'
import { RecordWatchReader, useIdleReady, useRecordWatch, type RecordWatchView } from './chrome/RecordWatch.live'
import { killState } from './chrome/StatusBar.format'
import { LiveStatusBar, useHealthState } from './chrome/StatusBar.live'
import type { FocusedPanel, ShownLayout, WorkspaceHandle } from './chrome/Workspace'
import type { previewText } from './chrome/WorkspacePreview'
import { CHROME, MESSAGES } from './copy/chrome'
import { LAYOUT } from './copy/layout'
import { WORKSPACE, fillCopy } from './copy/workspace'
import { useLinkGroups } from './state/linkGroups'
import { applyScheme, loadScheme, saveScheme } from './chrome/FrameStrip.scheme'
import './chrome/FrameStrip.frame.css'

// WorkspacePreview (previewText and the plan describer) stays out of the shell, about 480 B gzip: it loads
// beside the Workspace chunk, and the <GO> preview row says nothing until it has. The Workspace chunk
// imports WorkspacePreview itself, so waiting for both costs no extra request, and the row is ready with
// the first render of the Workspace.
let previewer: typeof previewText | null = null

const Workspace = lazy(async () => {
  const [workspace, preview] = await Promise.all([import('./chrome/Workspace'), import('./chrome/WorkspacePreview')])
  previewer = preview.previewText
  return workspace
})

type ChromeWorkspaceHandle = WorkspaceHandle & ChromeWorkspace

function WorkspaceLoading() {
  return (
    <main className="workspace nqt-workspace" aria-label={WORKSPACE.label} aria-busy="true">
      <p className="ws-empty">{WORKSPACE.loading}</p>
    </main>
  )
}

function isTextField(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea, select'))
}

/** Where focus is, for the global keys: the command line, and whether its line is empty. */
function keyWhere(cmd: CommandLineHandle | null): KeyWhere {
  const active = document.activeElement
  return { inCommandLine: active?.id === 'cmd', lineEmpty: (cmd?.lineText() ?? '') === '', inTextField: isTextField(active) }
}

function useScheme() {
  const [scheme, setScheme] = useState<ColourScheme>(() => loadScheme())
  useLayoutEffect(() => applyScheme(scheme), [scheme])
  const choose = (next: ColourScheme) => {
    setScheme(next)
    saveScheme(next)
    postMessage(MESSAGES.theme)
  }
  return { scheme, choose }
}

interface ChromeRefs {
  readonly cmd: RefObject<CommandLineHandle | null>
  readonly workspace: RefObject<ChromeWorkspaceHandle | null>
  readonly panelId: RefObject<string | null>
  readonly focused: RefObject<FocusedPanel | null>
}

function chromeEnv(refs: ChromeRefs, toggleKeymap: () => void): ChromeEnv {
  const contextLine = (c: ResolvedContext | null | undefined) => (c ? displayContext(c, null) : null)
  return {
    cmd: () => refs.cmd.current,
    workspace: () => refs.workspace.current,
    focusedPanelId: () => refs.panelId.current,
    focusedCode: () => refs.focused.current?.params.code ?? null,
    focusedContextLine: () => contextLine(refs.focused.current?.context),
    toggleKeymap,
  }
}

/**
 * What the command line asks of the layout (roadmap #6): RESET and UNDO answer with the text the message
 * line posts, and the <GO> preview row says what Enter, or Shift+Enter (a new panel), would do with the
 * typed line. All read the workspace when they run. Before the Workspace has loaded RESET and the preview
 * answer null (the command line says the layout is not ready) and UNDO says there is nothing to undo.
 */
function layoutCallbacks(refs: ChromeRefs, screen: MnemonicCode) {
  return {
    onReset: (): string | null => {
      const result = refs.workspace.current?.resetLayout()
      return result ? fillCopy(result === 'reset' ? LAYOUT.reset : LAYOUT.resetDefault, { screen }) : null
    },
    onUndo: (): string | null => {
      const restored = refs.workspace.current?.undo()
      return restored ? fillCopy(LAYOUT.undone, { screen: restored }) : LAYOUT.undoNone
    },
    previewRun: (command: ParsedCommand, newPanel: boolean): string | null => {
      const preview = refs.workspace.current?.preview(command, newPanel ? 'new-panel' : 'replace')
      return (preview && previewer?.(preview, newPanel ? 'shift' : 'enter')) || null
    },
  }
}

interface ChromeHeaderProps {
  readonly shown: ShownLayout
  readonly focused: FocusedPanel | null
  readonly panel: { readonly id: string | null; readonly number: number | null }
  readonly refs: ChromeRefs
  readonly env: ChromeEnv
  readonly actions: ChromeActions
  readonly watch: RecordWatchView
}

/** The four chrome rows above the workspace. */
function ChromeHeader({ shown, focused, panel, refs, env, actions, watch }: ChromeHeaderProps) {
  const tapeOn = useTapeOn()
  const scheme = useScheme()
  const health = useHealthState()
  const group = focused?.params.group ?? null
  const nav = focused ? { code: focused.params.code, group: focused.params.group, context: focused.context } : null
  const openNew = () => {
    refs.cmd.current?.focus()
    postMessage(MESSAGES.newLayout)
  }
  const loadContext = (context: ResolvedContext) => {
    if (group && group !== '-') useLinkGroups.getState().setContext(group, context)
  }
  return (
    <header className="nqt-chrome">
      <FrameStrip
        screen={shown.code}
        edited={shown.edited}
        tapeOn={tapeOn}
        scheme={scheme.scheme}
        onOpen={(code) => actions.runAndFocus(code)}
        onNew={openNew}
        onTape={() => toggleTape()}
        onScheme={scheme.choose}
        onUndo={() => actions.runAndFocus('UNDO')}
        onReset={() => actions.runAndFocus('RESET')}
      />
      <KeyToolbar onKey={(key) => runKey(actions, env, key)} />
      <NavToolbar focused={nav} kill={killState(health)} onAction={(a) => runNav(actions, env, a)} />
      <CommandZone
        commandRef={refs.cmd}
        focusedGroup={group}
        panelNumber={panel.number}
        resolveFallback={() => refs.workspace.current?.focusedContext() ?? null}
        onRun={(command, target) => refs.workspace.current?.run(command, target) ?? false}
        onReturnFocus={() => refs.workspace.current?.focusPanel() ?? false}
        onContext={loadContext}
        onNumber={(n) => (panel.id ? activateNumbered(panel.id, n) : false)}
        onTape={() => toggleTape()}
        onBack={() => actions.back(false)}
        onMenu={() => refs.workspace.current?.openRelatedMenu?.(panel.id ?? undefined) ?? false}
        focusedCode={() => focused?.params.code ?? null}
        watchMenu={() => watch.menu()}
        onWatchSeen={() => watch.accept()}
        {...layoutCallbacks(refs, shown.code)}
      />
    </header>
  )
}

function Terminal() {
  // The layout owner and its edited flag, as the Workspace reports them (never the last command's screen).
  const [shown, setShown] = useState<ShownLayout>({ code: 'HOME', edited: false, workspace: null })
  const [focused, setFocused] = useState<FocusedPanel | null>(null)
  const [keymapOpen, setKeymapOpen] = useState(false)
  // The panel the command line addresses, as the workspace reports it: last focused, else the panel
  // the last command ran in, else panel 1 (look spec 4.2, 4.3).
  const panel = { id: focused?.panelId ?? null, number: focused?.number ?? null }
  const tapeOn = useTapeOn()
  // The six reads of the record watch start at the browser's first idle moment (at the latest 4 s), so they
  // never compete with HOME's first render. The reader renders nothing; its view is read with useRecordWatch.
  const idle = useIdleReady()
  const watch = useRecordWatch()
  const refs: ChromeRefs = {
    cmd: useRef<CommandLineHandle>(null),
    workspace: useRef<ChromeWorkspaceHandle>(null),
    panelId: useRef<string | null>(null),
    focused: useRef<FocusedPanel | null>(null),
  }
  refs.panelId.current = panel.id
  refs.focused.current = focused
  // Built once: the env reads the refs above, which always hold the latest values.
  const [env] = useState(() => chromeEnv(refs, () => setKeymapOpen((o) => !o)))
  const [actions] = useState(() => createChromeActions(env))
  useTerminalKeys(() => keyWhere(refs.cmd.current), (action) => runGlobalKey(actions, env, action))
  return (
    <div className="nqt-frame">
      <h1 className="sr-only">{CHROME.appTitle}</h1>
      <ChromeHeader shown={shown} focused={focused} panel={panel} refs={refs} env={env} actions={actions} watch={watch} />
      <ConnectionStrip />
      <Suspense fallback={<WorkspaceLoading />}>
        <Workspace ref={refs.workspace} onLayoutChange={setShown} onLayoutDropped={(code) => postMessage(fillCopy(LAYOUT.dropped, { screen: code }))} onFocusedPanelChange={setFocused} />
      </Suspense>
      {tapeOn ? <LiveEventTape /> : null}
      <LiveStatusBar screen={shown.code} edited={shown.edited} watch={watch} />
      {keymapOpen ? <KeyMapOverlay onClose={() => setKeymapOpen(false)} /> : null}
      {idle ? <RecordWatchReader /> : null}
    </div>
  )
}

export default function App() {
  return (
    <ApiProvider supervise>
      <Terminal />
    </ApiProvider>
  )
}
