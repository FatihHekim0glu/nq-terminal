// The G2 rows (04 D5 exit table; 03 section 18). Every row has a target, a ceiling that fails, the builds it is
// measured on and the method each build uses. A row passes only if every build it was measured on is within its
// ceiling (04 D5, "Exit criteria"). Process-level rows are read on both builds; page-internal rows need the debugging
// protocol, which only the GNU smoke build has.

export const BUILDS = ['smoke', 'measure']

const SMOKE_CDP = 'smoke build over the debugging protocol (port from DevToolsActivePort)'

export const ROWS = Object.freeze([
  { id: 'backend_ready', label: 'Backend ready, quiet machine', unit: 'ms', target: 1500, ceiling: 2500, builds: ['smoke', 'measure'],
    method: { smoke: 'shell log: spawn to supervise_checked', measure: 'shell log: spawn to supervise_checked' } },
  { id: 'splash_painted', label: 'Shell painted (splash)', unit: 'ms', target: 500, ceiling: 1000, builds: ['smoke', 'measure'],
    method: { smoke: 'first-contentful-paint of the splash page over CDP (shell log page_finished when attached late)', measure: 'shell log: spawn to page_finished of the splash (the load event, not a painted frame)' } },
  { id: 'cold_home', label: 'Cold double-click to HOME with data', unit: 'ms', target: 3500, ceiling: 5000, builds: ['smoke', 'measure'],
    method: { smoke: 'HOME ready mark of the page probe, from spawn', measure: 'shell log: spawn to home_painted (the shell\'s own first-paint signal, 500 ms poll)' } },
  { id: 'warm_home', label: 'Warm HOME with data', unit: 'ms', target: 1000, ceiling: 1500, builds: ['smoke'], method: { smoke: `${SMOKE_CDP}: reload, HOME ready mark since navigation start` } },
  { id: 'eq_warm', label: 'Real-data EQ, warm', unit: 'ms', target: 1000, ceiling: 1500, builds: ['smoke'], needsRealData: true, method: { smoke: `${SMOKE_CDP}: command line to painted panel, second run` } },
  { id: 'reg_warm', label: 'Real-data REG, warm', unit: 'ms', target: 1000, ceiling: 1500, builds: ['smoke'], needsRealData: true, method: { smoke: `${SMOKE_CDP}: command line to painted panel, second run` } },
  { id: 'grid_open', label: 'Grid open, 8,411 fills', unit: 'ms', target: 100, ceiling: 500, builds: ['smoke'], method: { smoke: `${SMOKE_CDP}: Fills tab click to the painted 8,411-row grid` } },
  { id: 'gip_pan_zoom_p95', label: 'GIP pan and zoom p95 at 20,000 bars', unit: 'ms', target: 16.7, ceiling: 25, builds: ['smoke'], method: { smoke: `${SMOKE_CDP}: CDP trace, compositor DrawFrame intervals, worse of zoom and pan` } },
  { id: 'keystroke_p95', label: 'Keystroke to paint, command line, p95', unit: 'ms', target: 50, ceiling: 100, builds: ['smoke'], method: { smoke: `${SMOKE_CDP}: keydown to the second animation frame after it` } },
  { id: 'idle_mem_home', label: 'Whole app idle at HOME (private working set)', unit: 'MB', target: 400, ceiling: 500, builds: ['smoke', 'measure'],
    method: { smoke: 'performance counters, whole tree, after HOME settled', measure: 'performance counters, whole tree, after the shell\'s home_painted and a settle period' } },
  { id: 'soak_mem', label: 'Whole app, all-day soak at the shipped caps', unit: 'MB', target: 1000, ceiling: 1500, builds: ['smoke'], soak: true, method: { smoke: 'soak runner: whole-tree private working set every 5 minutes, the largest sample' } },
  { id: 'installer_mb', label: 'Installer', unit: 'MB', target: 15, ceiling: 30, builds: ['release'], method: { release: 'size of the NSIS installer file' } },
])

export const rowById = (id) => ROWS.find((r) => r.id === id) ?? null

/** The rows a launch of `build` takes (the soak and the installer have their own runners). */
export function rowsForLaunch(build, { realData = false } = {}) {
  return ROWS.filter((r) => r.builds.includes(build) && !r.soak && (realData || !r.needsRealData))
}

export function verdictOf(row, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'missing'
  if (value > row.ceiling) return 'over-ceiling'
  return value <= row.target ? 'within-target' : 'within-ceiling'
}

export const MB = 1048576

/** Conditions G2 requires that are not budget rows (04 D5 exit list); each has a ceiling that fails. */
export const CHECKS = Object.freeze({
  minimise_sim_stream_back_ms: { label: 'Stream back in stream mode after the simulated minimise', unit: 'ms', ceiling: 30_000 },
  minimise_real_stream_back_ms: { label: 'Stream back in stream mode after the real minimise and restore (screen 2)', unit: 'ms', ceiling: 30_000 },
})
