// Drill-down from REG and MT: a row opens DES for its hypothesis (or sealed confirmation) through the
// command line, so the request goes through the same parser and panel history as typing it. A grid row
// opened with Shift asks for a new panel (G20), as HELP promises, instead of replacing the grid.
import { requestLine } from '../../chrome/CommandLine.bus'
import type { OpenOptions } from '../../grids/MonitorGrid'

export function openDes(name: string, options?: OpenOptions): void {
  requestLine(`${name} DES`, options?.newPanel ?? false)
}
