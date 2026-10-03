// The wait for one docked panel in the heavy set. bench_browser.py waits for "no aria-busy anywhere"; with six docked panels the
// volmanaged_v0 DES charts sit in a 198 px wide panel, collapse to height 0 and never draw (aria-busy stays true), in every shell.
// The strict wait passed in the Tauri spike only because it ran before those charts mounted; Electron mounts them in the same commit as the
// panel title, so it never passed. This wait ignores a busy container with no height (it cannot draw) and keeps waiting for any other.
import { waitScreen } from './pagejs.mjs'

const BUSY = '[aria-busy="true"]:not(td):not([role="gridcell"])'

// Pure form of the page predicate below, kept in step with it by the test (stub document).
export function dockReady(doc, line) {
  return Array.from(doc.querySelectorAll('[data-nqt-title]')).some((p) => p.getAttribute('data-nqt-title') === line)
    && doc.querySelector('p.ws-empty') === null
    && !Array.from(doc.querySelectorAll('[aria-busy="true"]:not(td):not([role="gridcell"])')).some((e) => e.getBoundingClientRect().height > 0)
}

const STRICT = `document.querySelector('${BUSY}') === null;`
const strictBusy = (src) => {
  if (!src.includes(STRICT)) throw new Error('the strict wait of pagejs.mjs changed; update dockwait.mjs')
  return src
}

// The same page expression as waitScreen(line) (same timeout, message and result shape) with the busy test replaced.
export function waitDockPanel(line) {
  const src = strictBusy(waitScreen(line))
  const heightAware = `!Array.from(document.querySelectorAll('${BUSY}')).some((e) => e.getBoundingClientRect().height > 0);`
  return src.replace(STRICT, heightAware)
}
