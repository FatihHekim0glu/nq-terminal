// The terminal frame (UI_SPEC section 2): the command-line bar (live CommandLine, ContextStrip and the
// safety labels), the dockview Workspace and the live StatusBar. Data comes only through the typed GET
// client (src/api) under one ApiProvider; link-group contexts and user layouts come from the zustand
// stores (src/state). The Workspace (and dockview with it) loads as its own chunk, so the frame and
// its safety labels paint first.
import { Suspense, lazy, useRef, useState } from 'react'
import { ApiProvider } from './api/ApiProvider'
import CommandLineBar from './AppCommandBar'
import type { MnemonicCode } from './commands/registry'
import { LiveStatusBar } from './chrome/StatusBar.live'
import type { FocusedPanel, WorkspaceHandle } from './chrome/Workspace'
import { FRAME } from './copy/frame'
import { WORKSPACE } from './copy/workspace'

const Workspace = lazy(() => import('./chrome/Workspace'))

function WorkspaceLoading() {
  return (
    <main className="workspace nqt-workspace" aria-label={WORKSPACE.label} aria-busy="true">
      <p className="ws-empty">{WORKSPACE.loading}</p>
    </main>
  )
}

function Terminal() {
  const [screen, setScreen] = useState<MnemonicCode>('HOME')
  const [focused, setFocused] = useState<FocusedPanel | null>(null)
  const workspace = useRef<WorkspaceHandle>(null)

  return (
    <div className="frame">
      <h1 className="sr-only">{FRAME.appTitle}</h1>
      <CommandLineBar
        focusedGroup={focused?.params.group ?? null}
        resolveFallback={() => workspace.current?.focusedContext() ?? null}
        onRun={(command, target) => workspace.current?.run(command, target)}
        onReturnFocus={() => workspace.current?.focusPanel() ?? false}
      />
      <Suspense fallback={<WorkspaceLoading />}>
        <Workspace ref={workspace} onScreenChange={setScreen} onFocusedPanelChange={setFocused} />
      </Suspense>
      <LiveStatusBar screen={screen} />
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
