// The dockview probe (D7.2; G1 item 2): the workspace's layout survives a save and a restore in this engine. It draws a small
// dockview in the host element with three panels in two groups, saves the layout as the workspace store does (api.toJSON, the
// SerializedDockview the app persists), clears the view, restores it with api.fromJSON and compares what comes back. The
// dockview stays mounted afterwards, so axe sees it with the rest of the page.
import { DockviewReact, type DockviewApi, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { createRoot } from 'react-dom/client'
import type { ProbeOutcome } from './run.ts'

const READY_MS = 10_000

function Pane({ api }: IDockviewPanelProps) {
  return <p className="selftest-pane">{api.title}</p>
}

const COMPONENTS = { pane: Pane }

/** Draws the dockview into `host` and resolves with its api once it is ready. */
function mount(host: HTMLElement): Promise<DockviewApi> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dockview was not ready in ${READY_MS} ms`)), READY_MS)
    createRoot(host).render(
      <DockviewReact
        className="dockview-theme-abyss"
        components={COMPONENTS}
        onReady={(event) => {
          clearTimeout(timer)
          resolve(event.api)
        }}
      />,
    )
  })
}

function arrange(api: DockviewApi): void {
  api.addPanel({ id: 'alpha', component: 'pane', title: 'Alpha' })
  api.addPanel({ id: 'beta', component: 'pane', title: 'Beta', position: { referencePanel: 'alpha', direction: 'right' } })
  api.addPanel({ id: 'gamma', component: 'pane', title: 'Gamma', position: { referencePanel: 'alpha', direction: 'within' } })
  api.getPanel('alpha')?.api.setActive()
}

/**
 * Hides every group's tab strip and drops the tabpanel role it leaves orphaned, as the workspace does (PanelChrome is the app's
 * header; chrome/WorkspaceController.ts prepareGroup). The tab strip's own close buttons sit inside tab elements, which axe
 * reports as nested interactive controls, so the app never shows it and neither does the page.
 */
function hideTabStrips(api: DockviewApi): void {
  for (const group of api.groups) {
    group.header.hidden = true
    for (const el of group.element.querySelectorAll('.dv-content-container')) {
      el.removeAttribute('role')
      el.removeAttribute('aria-labelledby')
    }
  }
}

const idsOf = (api: DockviewApi): string => api.panels.map((p) => p.id).sort().join(',')

/** Saves, clears and restores; fails with the first thing that did not come back the same. */
export function layoutRestores(api: DockviewApi): ProbeOutcome {
  arrange(api)
  const saved = api.toJSON()
  const before = { ids: idsOf(api), groups: api.groups.length, active: api.activePanel?.id }
  api.clear()
  if (api.panels.length !== 0) return { status: 'fail', detail: `clear left ${api.panels.length} panels` }
  api.fromJSON(saved)
  const after = { ids: idsOf(api), groups: api.groups.length, active: api.activePanel?.id }
  const same = JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(api.toJSON()) === JSON.stringify(saved)
  hideTabStrips(api) // after the comparison: a hidden header is part of the layout dockview writes
  return same
    ? { status: 'pass', detail: `${after.groups} groups and panels ${after.ids} came back as saved, active ${String(after.active)}` }
    : { status: 'fail', detail: `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}` }
}

/** Draws the dockview into `host` and runs the save and restore on it. */
export async function runDockviewProbe(host: HTMLElement): Promise<ProbeOutcome> {
  return layoutRestores(await mount(host))
}
