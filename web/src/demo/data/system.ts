// System bodies of the demo dataset, built here (there is no capture): /api/health says fixture mode, so the
// status line shows its FIXTURE segment, and /api/commands indexes every id a screen lists (G01): the registry
// rows and the runs list, as the real backend does, not only the ids the demo holds a body for. A listed id
// with no captured body parses, opens its screen, and the route answers the honest 'not in the demo dataset'.
import type { Schemas } from '../../api/types'
import { MNEMONICS } from '../../commands/registry'
import { ROOTS } from '../../screens/mon/testUniverse'
import { CONFIRMATIONS, REGISTRY } from './research'
import { RUNS } from './runs'

/**
 * GET /api/health at `now`. Versions and pins as the App tests' fixture health reads them (src/App.test.tsx); the
 * sealed pins as the fixture files hold them (backend/tests/fixtures/manifest.json); no gate read, nothing cached.
 */
export function health(now: Date): Schemas['DesktopHealth'] {
  return {
    now_utc: now.toISOString(),
    nautilus_version: '1.231.0',
    pins: { pandas: '2.3.3', pyarrow: '25.0.1', quantpad_data: '0.8.0', nautilus: '1.231.0' },
    fence: { is_start: '2010-01-01', is_end: '2022-01-01' },
    sealed: { openings_pin_ok: true, sealed_log_pin_ok: true, openings_closed: true },
    kill_switch_on: false,
    gate_reads_this_process: 0,
    cache: { series: 0, bytes: 0 },
    fixture_mode: true,
    // The shell fields (03 4.4, 4.6): the demo is a static page, so it names no contract hash and has no fixed port.
    contract: 1,
    openapi_sha256: null,
    dist: 'current',
    port_fixed: false,
  }
}

/**
 * GET /api/commands: the registry's mnemonics, the 27 universe roots, every registry row as a hypothesis
 * (backend/nq_terminal/api/commands.py builds them from the registry) and every run of the runs list.
 */
export const COMMAND_INDEX: Schemas['CommandIndex'] = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: MNEMONICS.map(({ code, screen, priority, context }) => ({ code, screen, priority, context })),
  instruments: ROOTS.map(([root, sector]) => ({ root, symbol: `${root}.V.0`, sector })),
  universe: ['27F'],
  hypotheses: REGISTRY.rows.map((row) => row.name),
  confirmations: CONFIRMATIONS.map((c) => c.name),
  runs: RUNS.map((run) => run.run_id),
  registry_error: null,
}
