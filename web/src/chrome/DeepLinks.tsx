// The address bar's link reader as a component (shell diet 3, roadmap wave 9): it mounts useDeepLinks and renders
// nothing. AppCommandBar.tsx reaches it only through import('./chrome/DeepLinks'), so the reader, its allowlist
// (deepLink.ts) and the words it refuses with (copy/links.ts) load after first paint and never with the shell.
import { useDeepLinks } from './useDeepLinks'

export default function DeepLinks(): null {
  useDeepLinks()
  return null
}
