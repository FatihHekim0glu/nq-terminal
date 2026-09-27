// The terminal frame (spec 4.1), top to bottom: frame strip 37px, key toolbar 32px, nav toolbar 22px,
// command zone 50px, the dockview workspace, the event tape (57px, off by default, decision D4) and the
// 22px status line (decision D7). Data comes only through the typed GET client (src/api) under one
// ApiProvider; link-group contexts and user layouts come from the zustand stores (src/state). The
// Workspace (and dockview with it) loads as its own chunk, so the frame and its safety labels paint
// first. The chrome's keys and buttons run through KeyToolbar.actions.ts; nothing here can place,
// change or withdraw anything.
import { Suspense, lazy, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ApiProvider } from './api/ApiProvider'
import CommandZone from './AppCommandBar'
import type { MnemonicCode } from './commands/registry'
import { displayContext } from './commands/sectors'
import type { ResolvedContext } from './commands/types'
import type { CommandLineHandle } from './chrome/CommandLine'
import { useTerminalKeys, type KeyWhere } from './chrome/CommandLine.keys'
import { LiveEventTape } from './chrome/EventTape.live'
import { toggleTape, useTapeOn } from './chrome/EventTape.store'
import { FrameStrip, type ColourScheme } from './chrome/FrameStrip'
import { KeyToolbar } from './chrome/KeyToolbar'
import { createChromeActions, runGlobalKey, runKey, runNav, type ChromeActions, type ChromeEnv, type ChromeWorkspace } from './chrome/KeyToolbar.actions'
import { KeyMapOverlay } from './chrome/KeyToolbar.overlay'
import { postMessage } from './chrome/MessageLine.store'
import { NavToolbar } from './chrome/NavToolbar'
import { activateNumbered } from './chrome/NumberedActions'
import { LiveStatusBar, useHealthState } from './chrome/StatusBar.live'
import type { FocusedPanel, WorkspaceHandle } from './chrome/Workspace'
import { CHROME, MESSAGES } from './copy/chrome'
import { WORKSPACE } from './copy/workspace'
import { useLinkGroups } from './state/linkGroups'
import { applyScheme, loadScheme, saveScheme } from './chrome/FrameStrip.scheme'
import './chrome/FrameStrip.frame.css'

const Workspace = lazy(() => import('./chrome/Workspace'))

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

interface ChromeHeaderProps {
  readonly screen: MnemonicCode
  readonly focused: FocusedPanel | null
  readonly panel: { readonly id: string | null; readonly number: number | null }
  readonly refs: ChromeRefs
  readonly env: ChromeEnv
  readonly actions: ChromeActions
}

/** The four chrome rows above the workspace. */
function ChromeHeader({ screen, focused, panel, refs, env, actions }: ChromeHeaderProps) {
  const tapeOn = useTapeOn()
  const scheme = useScheme()
  const health = useHealthState()
  const group = focused?.params.group ?? null
  const kill = health.status === 'ok' ? (health.data.kill_switch_on ? 'on' : 'off') : 'unknown'
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
      <FrameStrip screen={screen} tapeOn={tapeOn} scheme={scheme.scheme} onOpen={(code) => actions.runAndFocus(code)} onNew={openNew} onTape={() => toggleTape()} onScheme={scheme.choose} />
      <KeyToolbar onKey={(key) => runKey(actions, env, key)} />
      <NavToolbar focused={nav} kill={kill} onAction={(a) => runNav(actions, env, a)} />
      <CommandZone
        commandRef={refs.cmd}
        focusedGroup={group}
        panelNumber={panel.number}
        resolveFallback={() => refs.workspace.current?.focusedContext() ?? null}
        onRun={(command, target) => refs.workspace.current?.run(command, target)}
        onReturnFocus={() => refs.workspace.current?.focusPanel() ?? false}
        onContext={loadContext}
        onNumber={(n) => (panel.id ? activateNumbered(panel.id, n) : false)}
        onTape={() => toggleTape()}
        onBack={() => actions.back(false)}
        onMenu={() => refs.workspace.current?.openRelatedMenu?.(panel.id ?? undefined) ?? false}
        focusedCode={() => focused?.params.code ?? null}
      />
    </header>
  )
}

function Terminal() {
  const [screen, setScreen] = useState<MnemonicCode>('HOME')
  const [focused, setFocused] = useState<FocusedPanel | null>(null)
  const [keymapOpen, setKeymapOpen] = useState(false)
  // The panel the command line addresses, as the workspace reports it: last focused, else the panel
  // the last command ran in, else panel 1 (look spec 4.2, 4.3).
  const panel = { id: focused?.panelId ?? null, number: focused?.number ?? null }
  const tapeOn = useTapeOn()
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
      <ChromeHeader screen={screen} focused={focused} panel={panel} refs={refs} env={env} actions={actions} />
      <Suspense fallback={<WorkspaceLoading />}>
        <Workspace ref={refs.workspace} onScreenChange={setScreen} onFocusedPanelChange={setFocused} />
      </Suspense>
      {tapeOn ? <LiveEventTape /> : null}
      <LiveStatusBar screen={screen} />
      {keymapOpen ? <KeyMapOverlay onClose={() => setKeymapOpen(false)} /> : null}
    </div>
  )
}

export default function App() {
  return (
    <ApiProvider>
      <Terminal />
    </ApiProvider>
  )
}
