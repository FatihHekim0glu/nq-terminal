// The on-screen switch for the read-only IB snapshot (O10). The page asks the desktop shell to turn the snapshot on or
// off for the next start by navigating to one of two exact addresses; the shell recognises them in its navigation
// check, cancels the navigation (the page stays where it is) and asks the owner in a native dialog, which is the only
// way the setting changes. This is not a command channel: the page calls nothing of the shell and gets no answer, and
// scripts/noShellIpc.test.ts keeps the shell's own host out of every other file in web/src.
// desktop/src-tauri/src/ib_switch.rs holds the same two addresses, and a test there reads this file to keep them equal.

/** Ask the shell to turn the read-only IB snapshot on for the next start. */
export const IB_SWITCH_ON_URI = 'http://tauri.localhost/ib-snapshot/on'
/** Ask the shell to turn the read-only IB snapshot off for the next start. */
export const IB_SWITCH_OFF_URI = 'http://tauri.localhost/ib-snapshot/off'

/** The address that asks for `next`. */
export function ibSwitchUri(next: boolean): string {
  return next ? IB_SWITCH_ON_URI : IB_SWITCH_OFF_URI
}

/**
 * Asks the shell for `next` (true: on, false: off). The shell cancels the navigation, so the page is not left; it
 * answers in its own dialog. `assign` is the window's location.assign, given in tests.
 */
export function requestIbSwitch(next: boolean, assign: (url: string) => void = (url) => window.location.assign(url)): void {
  assign(ibSwitchUri(next))
}
