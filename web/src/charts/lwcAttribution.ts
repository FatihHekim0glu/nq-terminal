// lightweight-charts draws its TradingView attribution logo (attributionLogo: true, kept on as the
// spec asks) as a link inside the chart's own element. CandleChart sits inside ChartA11y's
// role="img" figure, whose children are presentational, so a focusable link there fails WCAG
// (axe nested-interactive): keyboard users would reach a control that screen readers cannot name.
// This keeps the logo on screen but makes it inert (out of the tab order and the accessibility
// tree). The licence asks for the NOTICE text and a link to tradingview.com on a page users can
// reach: the HELP screen carries both (copy/help.ts, licences and attributions).
export const LWC_ATTRIBUTION_SELECTOR = 'a#tv-attr-logo'

function quiet(root: ParentNode): void {
  for (const a of root.querySelectorAll<HTMLElement>(LWC_ATTRIBUTION_SELECTOR)) {
    if (a.hasAttribute('inert')) continue
    a.setAttribute('inert', '')
    a.setAttribute('aria-hidden', 'true')
    a.setAttribute('tabindex', '-1')
  }
}

/** Quiet the logo in `container` now and whenever the library re-creates it; returns the stop. */
export function quietAttributionLogo(container: HTMLElement): () => void {
  quiet(container)
  const observer = new MutationObserver(() => quiet(container))
  observer.observe(container, { childList: true, subtree: true })
  return () => observer.disconnect()
}
