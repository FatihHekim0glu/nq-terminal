"""JavaScript injected into / run in the terminal page (probe copied in spirit from web/e2e/perf/pages.ts installHomeProbe)."""
import json

HOME_READY = [
    ["NQ GP 1d", ['[role="img"][aria-label^="NQ1 Index: "]']],
    ["27F MON", ['[role="grid"]:not([aria-rowcount="1"])']],
    ["volmanaged_v0 EQ", ['ul[aria-label^="Key figures for "] .kpi-value', '[role="img"]']],
    ["REG", ['[role="grid"]:not([aria-rowcount="1"])']],
]

PROBE = """
(() => {
  if (window.__nqtProbe) return; window.__nqtProbe = true;
  try { localStorage.setItem('nqt.orientation', '1'); } catch (e) {}
  const ready = %s;
  const marked = new Set();
  const mark = (n) => { if (!marked.has(n)) { marked.add(n); performance.mark(n); } };
  const markRaf = (n) => { if (marked.has(n)) return; marked.add(n); requestAnimationFrame(() => requestAnimationFrame(() => performance.mark(n))); };
  const panelOk = ([title, sels]) => { const p = document.querySelector('[data-nqt-title="' + title + '"]'); return p !== null && sels.every((s) => p.querySelector(s) !== null); };
  const check = () => {
    if (document.querySelectorAll('[data-nqt-title]').length >= ready.length) { mark('nqt:home-frame-dom'); markRaf('nqt:home-frame'); }
    const loading = document.querySelector('p.ws-empty') !== null;
    const chartBusy = document.querySelector('[aria-busy="true"]:not(td):not([role="gridcell"])') !== null;
    if (!loading && !chartBusy && ready.every(panelOk)) { mark('nqt:home-ready-dom'); markRaf('nqt:home-ready'); }
    if (marked.has('nqt:home-ready') && document.querySelector('[aria-busy="true"]') === null) markRaf('nqt:home-settled');
  };
  const observer = new MutationObserver(check);
  const start = () => { observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); check(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__t0 = performance.now(); }, true);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  window.__errs = [];
  window.addEventListener('error', (e) => window.__errs.push('error ' + e.message));
  window.addEventListener('unhandledrejection', (e) => window.__errs.push('rejection ' + String(e.reason)));
  window.addEventListener('securitypolicyviolation', (e) => window.__errs.push('csp ' + e.violatedDirective + ' ' + e.blockedURI));
})();
""" % json.dumps(HOME_READY)

# Waits (MutationObserver, no timers) until the panel titled `line` exists, nothing is loading and nothing non-cell is busy.
WAIT_SCREEN = """
new Promise((resolve, reject) => {
  const line = %s; const t0 = window.__t0 ?? performance.now();
  const timer = setTimeout(() => { obs.disconnect(); reject(new Error('screen timeout: ' + line + ' titles=' + JSON.stringify(Array.from(document.querySelectorAll('[data-nqt-title]')).map((p) => p.getAttribute('data-nqt-title'))) + ' empty=' + (document.querySelector('p.ws-empty') !== null) + ' busy=' + Array.from(document.querySelectorAll('[aria-busy="true"]:not(td):not([role="gridcell"])')).slice(0,3).map((e) => e.tagName + ':' + (e.getAttribute('aria-label') || '')).join('|') + ' msg=' + ((document.querySelector('.msg-line') || {}).textContent || ''))); }, 45000);
  const ok = () => Array.from(document.querySelectorAll('[data-nqt-title]')).some((p) => p.getAttribute('data-nqt-title') === line)
    && document.querySelector('p.ws-empty') === null
    && document.querySelector('[aria-busy="true"]:not(td):not([role="gridcell"])') === null;
  const done = () => {
    obs.disconnect(); clearTimeout(timer);
    const tDom = performance.now();
    let fired = false;
    const fin = (tPaint) => { if (fired) return; fired = true; resolve({ t0, tDom, domMs: tDom - t0, paintMs: tPaint === null ? null : tPaint - t0, tEnd: performance.now(), panels: document.querySelectorAll('[data-nqt-panel]').length }); };
    requestAnimationFrame(() => requestAnimationFrame(() => fin(performance.now())));
    setTimeout(() => fin(null), 1500);
  };
  const obs = new MutationObserver(() => { if (ok()) done(); });
  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  if (ok()) done();
})
"""

# RUN panel: Fills tab, then View Pivot, then Show as Pivot grid; returns timings read from the page.
PIVOT = """
(async () => {
  const RUN = %s; const panel = document.querySelector('[data-nqt-title="' + RUN + ' RUN"]');
  if (!panel) throw new Error('no RUN panel');
  const until = (ok, ms = 40000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { o.disconnect(); reject(new Error('timeout: ' + ok.toString().slice(0, 100))); }, ms);
    const o = new MutationObserver(() => { if (ok()) { clearTimeout(timer); o.disconnect(); resolve(); } });
    o.observe(panel, { subtree: true, childList: true, attributes: true, characterData: true });
    if (ok()) { clearTimeout(timer); o.disconnect(); resolve(); }
  });
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const btn = (scope, label) => Array.from(scope.querySelectorAll('button')).find((b) => b.textContent === label);
  const t0 = performance.now();
  Array.from(panel.querySelectorAll('[role="tab"]')).find((t) => /Fills/.test(t.textContent)).click();
  await until(() => panel.querySelector('[role="grid"][aria-label^="Fills of ' + RUN + ',"]') !== null && /8[,]?411 rows/.test(panel.querySelector('[role="grid"][aria-label^="Fills of ' + RUN + ',"]').getAttribute('aria-label')));
  await raf2(); const fillsGridMs = performance.now() - t0;
  const view = panel.querySelector('[role="group"][aria-label="View"]');
  btn(view, 'Pivot').click();
  await until(() => panel.querySelector('[role="group"][aria-label="Show as"]') !== null);
  const toGrid = btn(panel.querySelector('[role="group"][aria-label="Show as"]'), 'Pivot grid');
  const t1 = performance.now();
  if (toGrid.getAttribute('aria-pressed') !== 'true') toGrid.click();
  await until(() => panel.querySelector('.nqt-psp-host[data-psp-state="ready"]') !== null);
  await raf2(); const pivotOpenMs = performance.now() - t1;
  const host = panel.querySelector('.nqt-psp-host');
  return { fillsGridMs, pivotOpenMs, loadMs: Number(host.getAttribute('data-psp-load-ms')), engineMs: Number(host.getAttribute('data-psp-engine-ms')), total: performance.now() - t0 };
})()
"""
