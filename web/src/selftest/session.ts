// Starts the self-test in a page: wires the real stages (the goldens in the page's engine, the probes, axe) into run.ts, and
// publishes every report as `window.__selftest`. Nothing here talks to the shell: the report is read over the debugging
// protocol by whoever drives the page, and nothing is written to the shell's log.
import { getBridge } from '../bridge'
import { runAxe } from './axe.ts'
import { createPublisher, runSelfTest, type Probe } from './run.ts'
import { PLAIN_PROBES } from './probes.ts'
import type { EngineInfo, GoldenReport, SelfTestReport } from './report.ts'

declare global {
  interface Window {
    /** The self-test's report, republished after every stage; `state: 'done'` when the run is over. */
    __selftest?: SelfTestReport
  }
}

export interface Hosts {
  readonly dockview: HTMLElement
}

export interface Session {
  /** Lets the gesture probes run (the person's click). */
  release(): void
  readonly finished: Promise<SelfTestReport>
}

async function runGoldensNow(): Promise<GoldenReport[]> {
  const [{ readGoldenData }, { loadQuant }, { runGoldens }] = await Promise.all([import('./goldenData.ts'), import('./quant.load.ts'), import('./goldens.ts')])
  return runGoldens(readGoldenData(), await loadQuant())
}

function engineInfo(): EngineInfo {
  const bridge = getBridge()
  return { userAgent: navigator.userAgent, shell: bridge.platform, keys: bridge.keys, bridgeVersion: bridge.bridgeVersion, webAssembly: typeof WebAssembly === 'object' }
}

/** The dockview probe loads dockview only when it runs, so the page's first paint does not wait for it. */
function dockviewProbe(host: HTMLElement): Probe {
  return { name: 'dockview_layout_restore', needsGesture: false, run: async () => (await import('./probes.dockview.tsx')).runDockviewProbe(host) }
}

/** The probes in the order they run: dockview among the plain ones, the two that need a click last. */
function probesFor(hosts: Hosts): Probe[] {
  const [perspective, ...rest] = PLAIN_PROBES
  return [perspective as Probe, dockviewProbe(hosts.dockview), ...rest]
}

/**
 * Begins the run. `onReport` sees every published report (the page's own view of it). With `autoGesture` the run does not wait
 * for a click, which a driver that cannot click may ask for (`?gesture=auto`); the clipboard and save probes then say plainly if
 * the browser refused them.
 */
export function startSelfTest(hosts: Hosts, onReport: (report: SelfTestReport) => void, autoGesture: boolean): Session {
  const toWindow = createPublisher(window)
  let release = (): void => undefined
  const gate = autoGesture ? Promise.resolve() : new Promise<void>((resolve) => { release = resolve })
  const finished = runSelfTest({
    goldens: runGoldensNow,
    axe: () => runAxe(document),
    probes: probesFor(hosts),
    waitForGesture: () => gate,
    engine: engineInfo,
    now: () => new Date(),
    publish: (report) => {
      toWindow(report)
      onReport(report)
    },
  })
  return { release: () => release(), finished }
}
