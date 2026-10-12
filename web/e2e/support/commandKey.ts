// The key that focuses the command line in the end-to-end specs. The app reads its key table from the platform of the page
// (src/chrome/CommandLine.keys.ts, detectKeysTable): a Mac has Cmd+K only, because Ctrl+K there is the text field's own
// kill-to-end-of-line; every other platform has Ctrl+K. Playwright's WebKit on a Mac reports a Mac platform, so the specs press
// Meta+K when the host is darwin and Control+K elsewhere. Test helpers only: the app's key behaviour is not changed here.

/** The Playwright chord that focuses the command line on the given host platform (a process.platform value). */
export function commandLineKey(platform: string): 'Meta+k' | 'Control+k' {
  return platform === 'darwin' ? 'Meta+k' : 'Control+k'
}

/** The chord for the machine the specs run on. */
export const COMMAND_LINE_KEY = commandLineKey(process.platform)

/** True for Playwright's WebKit projects of the offline config when the host is a Mac (the hosted runner), where frame budgets are not measured. */
export function isWebkitOnMac(projectName: string, platform: string = process.platform): boolean {
  return platform === 'darwin' && projectName.startsWith('offline-webkit')
}
