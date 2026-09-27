// Drill-down from REG and MT: a row opens DES for its hypothesis (or sealed confirmation) through the
// command line, so the request goes through the same parser and panel history as typing it.
import { requestLine } from '../../chrome/CommandLine.bus'

export function openDes(name: string): void {
  requestLine(`${name} DES`)
}
