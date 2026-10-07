// REG's registry staleness banner (V031): one polite live line (aria-live, so REG gains no second status role), text plus an icon, shown while results/registry.md
// is older than the newest result or spec. The region is always in the page and always mounts EMPTY, so it takes no room
// when the registry is fresh and the default look is unchanged. The line is put into it one tick after the region is in
// the page: a polite region announces what is inserted into it, not what it already held when it mounted, so this
// announces the line once on a cold open (the answer arrives later) and also on a cached open (the answer is there on
// the first render). Nothing in it writes anything: the registry is rebuilt by scripts/registry.py, outside the terminal.
import { useEffect, useState } from 'react'
import { registryStaleness, staleLine } from './regStale'

/** A warning triangle on the screen's own 14 px grid, drawn in the text colour; decorative, the line says it in words. */
function WarnIcon() {
  return (
    <svg className="reg-stale-icon" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M7 1.5 13 12.5H1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="miter" />
      <path d="M7 5.5v3.5M7 10.5v1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** The line to show, or null while the registry is fresh, unread or failed. A string, so a re-read of the same answer is the same value. */
function useStaleLineAfterMount(registry: unknown): string | null {
  const stale = registryStaleness(registry)
  const line = stale ? staleLine(stale) : null
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    if (line === null) {
      setShown(null)
      return undefined
    }
    const timer = setTimeout(() => setShown(line), 0)
    return () => clearTimeout(timer)
  }, [line])
  return line === null ? null : shown
}

/** `registry` is the GET /api/registry answer (undefined while it loads or after it failed). */
export default function RegStaleBanner({ registry }: { readonly registry: unknown }) {
  const line = useStaleLineAfterMount(registry)
  return (
    <div className="reg-stale" data-reg-stale="" aria-live="polite" aria-atomic="true">
      {line !== null ? (
        <>
          <WarnIcon />
          <span className="reg-stale-text">{line}</span>
        </>
      ) : null}
    </div>
  )
}
