// REG's registry staleness banner (V031): one polite live line (aria-live, so REG gains no second status role), text plus an icon, shown while results/registry.md
// is older than the newest result or spec. The region is always in the page (empty when the registry is fresh, so it
// takes no room and the default look is unchanged) so that a screen reader announces the line when it appears after
// the data arrives. Nothing in it writes anything: the registry is rebuilt by scripts/registry.py, outside the terminal.
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

/** `registry` is the GET /api/registry answer (undefined while it loads or after it failed). */
export default function RegStaleBanner({ registry }: { readonly registry: unknown }) {
  const stale = registryStaleness(registry)
  return (
    <div className="reg-stale" data-reg-stale="" aria-live="polite" aria-atomic="true">
      {stale ? (
        <>
          <WarnIcon />
          <span className="reg-stale-text">{staleLine(stale)}</span>
        </>
      ) : null}
    </div>
  )
}
