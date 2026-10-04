// The terminal frame (spec 4.1), top to bottom: frame strip 37px, key toolbar 32px, nav toolbar 22px,
// command zone 50px, the dockview workspace, the event tape (57px, off by default, decision D4) and the
// 22px status line (decision D7). Data comes only through the typed GET client (src/api) under one
// ApiProvider; link-group contexts and user layouts come from the zustand stores (src/state). The
// Workspace (and dockview with it) loads as its own chunk, so the frame and its safety labels paint
// first. The chrome's keys and buttons run through KeyToolbar.actions.ts, a chunk of its own that KeyToolbar.lazy.ts loads at the first idle moment; nothing here can place,
// change or withdraw anything. The Workspace reports the layout owner (the screen whose layout the panels
// are arranged under, and whether the viewer has edited it): the frame strip and the status line show it
// with an edited mark, and RESET, UNDO and the <GO> preview row on the command line act on it.
// The command line has focus from the first paint (U05), so a line typed straight after load is not lost to <body>.
// The provider supervises the backend connection (roadmap 7): the API DOWN strip sits under the header and
// the status line names the time the backend went quiet. The research-record watch (roadmap 16) reads its
// six records once HOME's own queries go quiet; its segment, WATCH <GO> and WATCH SEEN <GO> reach the chrome
// through useRecordWatch. The reader, the diff and their long copy load on demand, never with this file. GRAB <GO> asks
// the Workspace handle to grab the focused panel; the image code and its copy load with the Workspace and on
// demand, never through this file. SAVE, LOAD and FORGET (roadmap #14) go through the Workspace handle (saveWorkspace,
// loadWorkspace, forgetWorkspace) and the workspaces store (the tab list and the menu): the recipe type and its walker stay in
// the Workspace chunk, and the store loads beside it (see savedStore). The last workspace is restored by useDeepLinks.
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ApiProvider } from './api/ApiProvider'
import CommandZone from './AppCommandBar'
import type { LineResult } from './commands/line'
import type { MnemonicCode } from './commands/registry'
import { displayContext } from './commands/sectors'
import type { ParsedCommand } from './commands/parser'
import type { ResolvedContext } from './commands/types'
import type { CommandLineHandle } from './chrome/CommandLine'
import { useTerminalKeys, type KeyWhere } from './chrome/CommandLine.keys'
import ConnectionStrip from './chrome/ConnectionStrip'
import { toggleTape, useTapeOn } from './chrome/EventTape.store'
import { FrameStrip, type ColourScheme } from './chrome/FrameStrip'
import { KeyToolbar } from './chrome/KeyToolbar'
import { LazyBoundary } from './chrome/LazyBoundary'
import type { ChromeEnv, ChromeWorkspace } from './chrome/KeyToolbar.actions'
import { createLazyChrome, type LazyChrome } from './chrome/KeyToolbar.lazy'
import { postMessage } from './chrome/MessageLine.store'
import { NavToolbar } from './chrome/NavToolbar'
import { activateNumbered } from './chrome/NumberedActions'
import { workspaceMenu } from './chrome/WorkspaceMenu'
import { useIdleReady, useRecordWatch, type RecordWatchView } from './chrome/RecordWatch.view'
import { killState } from './chrome/StatusBar.format'
import { LiveStatusBar, useHealthState } from './chrome/StatusBar.live'
import type { FocusedPanel, ShownLayout, WorkspaceHandle } from './chrome/Workspace'
import type { previewText } from './chrome/WorkspacePreview'
import { CHROME, MESSAGES } from './copy/chrome'
import { LAYOUT } from './copy/layout'
import { WORKSPACE, fillCopy } from './copy/workspace'
import { requestHelpTopic } from './screens/help/helpTopic.store'
import { useLinkGroups } from './state/linkGroups'
import type { WorkspacesStore } from './state/workspaces'
import { applyScheme, loadScheme, saveScheme } from './chrome/FrameStrip.scheme'
import { useLook } from './theme/useLook'
import './chrome/FrameStrip.frame.css'

// WorkspacePreview (previewText and the plan describer) stays out of the shell, about 480 B gzip: it loads
// beside the Workspace chunk, and the <GO> preview row says nothing until it has. The Workspace chunk
// imports WorkspacePreview itself, so waiting for both costs no extra request, and the row is ready with
// the first render of the Workspace.
let previewer: typeof previewText | null = null

// The event tape (off by default, decision D4) and the key map overlay (Alt+K) are shown only when asked for,
// so they load as chunks of their own and render nothing until they have arrived; the shell carries neither
// (scripts/shellBudget.test.ts). The tape reads the gate log only once mounted, as before. A chunk that
// cannot be fetched is caught by a LazyBoundary and reported on the message line; the terminal stays up, and
// a saved "tape on" is left alone so it works after a reload.
const LiveEventTape = lazy(() => import('./chrome/EventTape.live').then((m) => ({ default: m.LiveEventTape })))
const KeyMapOverlay = lazy(() => import('./chrome/KeyToolbar.overlay').then((m) => ({ default: m.KeyMapOverlay })))
// The first-run orientation line (N03) shows under the connection strip while HOME owns the layout, and loads with
// its own chunk beside the Workspace: the shell carries none of its words. A chunk that cannot be fetched is dropped
// without a word, since the line is a courtesy and HELP says the same.
const HomeOrientation = lazy(() => import('./screens/home/HomeOrientation'))
// The record watch's reader (the six reads, the marks and WATCH SEEN) mounts after the first idle moment and loads as a
// chunk of its own then, so the shell carries the view (chrome/RecordWatch.view.tsx) and none of the reader. Its six reads
// wait inside that chunk until HOME's own queries have gone quiet (chrome/useQuietReady.ts, W5C D5). A chunk that
// cannot be fetched is dropped without a word: the watch is a courtesy and its segment simply stays away.
const RecordWatchReader = lazy(() => import('./chrome/RecordWatch.live').then((m) => ({ default: m.RecordWatchReader })))

const Workspace = lazy(async () => {
  const [workspace, preview] = await Promise.all([import('./chrome/Workspace'), import('./chrome/WorkspacePreview')])
  previewer = preview.previewText
  return workspace
})

// The workspaces store (state/workspaces.ts: the saved recipes and the checks that rebuild them from storage) is not
// needed for the first paint, and the Workspace chunk imports it anyway: it loads beside that chunk and stays out of the
// shell (scripts/shellBudget.test.ts). Until it has arrived the tabs are empty, and FORGET, LOAD on its own and the
// favourites list answer as the workspace does before it is ready. A chunk that cannot be fetched leaves it null.
let savedStore: WorkspacesStore | null = null
const storeLoaded: Promise<WorkspacesStore | null> = import('./state/workspaces').then(
  (m) => (savedStore = m.useWorkspaces),
  () => null,
)

type ChromeWorkspaceHandle = WorkspaceHandle & ChromeWorkspace

/** The names of the saved workspaces, in the order they were saved, kept up to date once the store has loaded. */
function useSavedNames(): readonly string[] {
  const [names, setNames] = useState<readonly string[]>([])
  useEffect(() => {
    let live = true
    let stop = () => {}
    void storeLoaded.then((store) => {
      if (!live || !store) return
      const read = () => setNames(Object.keys(store.getState().list))
      read()
      stop = store.subscribe(read)
    })
    return () => {
      live = false
      stop()
    }
  }, [])
  return names
}

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

// Dialogs, menus, lists and grids take letters of their own (typeahead, mnemonics): a letter typed in one is no stray
// letter. A grid that finds no row for a letter leaves the key alone, and Home is the grid's own key there.
const TAKES_LETTERS = '[role="dialog"], [role="menu"], [role="listbox"], [role="grid"], [role="treegrid"]'

/** Where focus is, for the global keys: the command line, and whether its line is empty. */
function keyWhere(cmd: CommandLineHandle | null): KeyWhere {
  const active = document.activeElement
  return {
    inCommandLine: active?.id === 'cmd',
    lineEmpty: (cmd?.lineText() ?? '') === '',
    inTextField: isTextField(active),
    inPopup: active?.closest(TAKES_LETTERS) != null,
  }
}

// Keys that are only a modifier on the way to another key: pressing one is not typing.
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']

/**
 * U05: focus the command line once the terminal has mounted, unless something already has focus. While that
 * boot focus is all there is (`fresh`), the first Esc on the empty line stays in the line: it has nothing to
 * cancel and nowhere to go back to, and moving to a panel would drop the reflexive "Esc, reg, Enter" typed
 * next (the hint on the message line covers the rest). The guard holds only an Esc pressed before any other key
 * since load: any other key (a bare modifier aside), any focus elsewhere and a line run all end it, so a parse
 * error, a context only line, End, a menu or HL never leave it armed for a much later Esc.
 */
function useBootFocus(cmd: RefObject<CommandLineHandle | null>): RefObject<boolean> {
  const fresh = useRef(false)
  useEffect(() => {
    const active = document.activeElement
    // The command line itself counts as nothing yet: StrictMode runs this effect twice, and the second run finds it focused.
    if (active && active !== document.body && active.id !== 'cmd') return undefined
    cmd.current?.focus()
    fresh.current = document.activeElement?.id === 'cmd'
    const leave = (e: FocusEvent) => {
      if ((e.target as Element | null)?.id !== 'cmd') fresh.current = false
    }
    // Capture phase, so it sees the key before a control that stops it; Esc itself is judged by holdBootFocus.
    const typed = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && !MODIFIERS.includes(e.key)) fresh.current = false
    }
    document.addEventListener('focusin', leave)
    document.addEventListener('keydown', typed, true)
    return () => {
      document.removeEventListener('focusin', leave)
      document.removeEventListener('keydown', typed, true)
    }
  }, [cmd])
  return fresh
}

/** True (once) for an Esc that only has the boot focus to give back; see useBootFocus. */
function holdBootFocus(fresh: RefObject<boolean>): boolean {
  const hold = fresh.current
  fresh.current = false
  return hold
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
  /** True while the command line still has only its boot focus (useBootFocus). */
  readonly fresh: RefObject<boolean>
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
    savedWorkspaces: () => savedStore?.getState().list ?? {},
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

/**
 * SAVE, LOAD and FORGET (roadmap #14). SAVE, LOAD and FORGET are the Workspace handle's: it derives the recipe, reads every
 * saved line again with the `parse` the command line hands it and refuses the whole load naming the failing line.
 * Before the Workspace has loaded they answer null (the command line says the workspace is not ready). FORGET is the
 * handle's too, since forgetting the workspace that owns the layout gives the layout back to the screen. The menu behind
 * LOAD on its own reads the store, and answers null in the same way until it has loaded.
 */
function workspaceCallbacks(refs: ChromeRefs) {
  return {
    onSaveWorkspace: (name: string): string | null => refs.workspace.current?.saveWorkspace(name) ?? null,
    onLoadWorkspace: (name: string, parse: (line: string) => LineResult): string | null => refs.workspace.current?.loadWorkspace(name, parse) ?? null,
    onForgetWorkspace: (name: string): string | null => refs.workspace.current?.forgetWorkspace(name) ?? null,
    workspaceMenu: () => savedStore && workspaceMenu(savedStore.getState().list),
  }
}

interface ChromeHeaderProps {
  readonly shown: ShownLayout
  readonly focused: FocusedPanel | null
  readonly panel: { readonly id: string | null; readonly number: number | null }
  readonly refs: ChromeRefs
  readonly chrome: LazyChrome
  readonly watch: RecordWatchView
}

/** The four chrome rows above the workspace. */
function ChromeHeader({ shown, focused, panel, refs, chrome, watch }: ChromeHeaderProps) {
  const tapeOn = useTapeOn()
  const scheme = useScheme()
  const look = useLook(() => postMessage(MESSAGES.theme))
  const health = useHealthState()
  const group = focused?.params.group ?? null
  const nav = focused ? { code: focused.params.code, group: focused.params.group, context: focused.context } : null
  const saved = useSavedNames()
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
        look={look.look}
        onLook={look.choose}
        onOpen={(code) => chrome.runAndFocus(code)}
        onNew={openNew}
        onTape={() => toggleTape()}
        onScheme={scheme.choose}
        onUndo={() => chrome.runAndFocus('UNDO')}
        onReset={() => chrome.runAndFocus('RESET')}
        workspaces={saved}
        workspace={shown.workspace}
        onOpenWorkspace={(name) => chrome.runAndFocus(`LOAD ${name}`)}
        onDemo={() => {
          // The DEMO DATA key (demo only): the HELP panel shows its own page, where About this demo comes first.
          requestHelpTopic('HELP')
          chrome.runAndFocus('HELP')
        }}
      />
      <KeyToolbar onKey={(key) => chrome.key(key)} />
      <NavToolbar focused={nav} kill={killState(health)} onAction={(a) => chrome.nav(a)} />
      <CommandZone
        commandRef={refs.cmd}
        focusedGroup={group}
        panelNumber={panel.number}
        resolveFallback={() => refs.workspace.current?.focusedContext() ?? null}
        onRun={(command, target) => {
          refs.fresh.current = false
          return refs.workspace.current?.run(command, target) ?? false
        }}
        onReturnFocus={() => holdBootFocus(refs.fresh) || (refs.workspace.current?.focusPanel() ?? false)}
        onContext={loadContext}
        onNumber={(n) => (panel.id ? activateNumbered(panel.id, n) : false)}
        onTape={() => toggleTape()}
        onBack={() => chrome.back(false)}
        onMenu={() => refs.workspace.current?.openRelatedMenu?.(panel.id ?? undefined) ?? false}
        onGrab={() => refs.workspace.current?.grab() ?? false}
        focusedCode={() => focused?.params.code ?? null}
        watchMenu={() => watch.menu()}
        onWatchSeen={() => watch.accept()}
        {...layoutCallbacks(refs, shown.code)}
        {...workspaceCallbacks(refs)}
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
  // The key actions load and the record watch's reader mounts at the browser's first idle moment (at the latest 4 s).
  // The reader's six reads then wait until HOME's own queries have settled and no fetch has been in flight for 500 ms,
  // then for the next idle moment (at the latest 12 s after it mounts), so they never compete with HOME's first reads.
  // The reader renders nothing; its view is read with useRecordWatch.
  const idle = useIdleReady()
  const watch = useRecordWatch()
  const cmd = useRef<CommandLineHandle>(null)
  const refs: ChromeRefs = {
    cmd,
    workspace: useRef<ChromeWorkspaceHandle>(null),
    panelId: useRef<string | null>(null),
    focused: useRef<FocusedPanel | null>(null),
    fresh: useBootFocus(cmd),
  }
  refs.panelId.current = panel.id
  refs.focused.current = focused
  // Built once: the env reads the refs above, which always hold the latest values.
  const [env] = useState(() => chromeEnv(refs, () => setKeymapOpen((o) => !o)))
  const [chrome] = useState(() => createLazyChrome(env))
  // The key actions load as a chunk of their own after the first idle moment (chrome/KeyToolbar.lazy.ts).
  useEffect(() => {
    if (idle) chrome.preload()
  }, [idle, chrome])
  useTerminalKeys(() => keyWhere(refs.cmd.current), (action) => chrome.global(action))
  return (
    <div className="nqt-frame">
      <h1 className="sr-only">{CHROME.appTitle}</h1>
      <ChromeHeader shown={shown} focused={focused} panel={panel} refs={refs} chrome={chrome} watch={watch} />
      <ConnectionStrip />
      {shown.code === 'HOME' && shown.workspace === null ? (
        <LazyBoundary onError={() => {}}>
          <Suspense fallback={null}>
            <HomeOrientation />
          </Suspense>
        </LazyBoundary>
      ) : null}
      <Suspense fallback={<WorkspaceLoading />}>
        <Workspace ref={refs.workspace} onLayoutChange={setShown} onLayoutDropped={(code) => postMessage(fillCopy(LAYOUT.dropped, { screen: code }))} onFocusedPanelChange={setFocused} />
      </Suspense>
      {tapeOn ? (
        <LazyBoundary onError={() => postMessage(MESSAGES.tapeFailed)}>
          <Suspense fallback={null}>
            <LiveEventTape />
          </Suspense>
        </LazyBoundary>
      ) : null}
      <LiveStatusBar screen={shown.code} edited={shown.edited} watch={watch} />
      {keymapOpen ? (
        <LazyBoundary
          onError={() => {
            setKeymapOpen(false)
            postMessage(MESSAGES.keymapFailed)
          }}
        >
          <Suspense fallback={null}>
            <KeyMapOverlay onClose={() => setKeymapOpen(false)} />
          </Suspense>
        </LazyBoundary>
      ) : null}
      {idle ? (
        <LazyBoundary onError={() => {}}>
          <Suspense fallback={null}>
            <RecordWatchReader />
          </Suspense>
        </LazyBoundary>
      ) : null}
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
