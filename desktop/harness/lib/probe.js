
(() => {
  if (window.__nqtProbe) return; window.__nqtProbe = true;
  try { localStorage.setItem('nqt.orientation', '1'); } catch (e) {}
  const ready = [["NQ GP 1d", ["[role=\"img\"][aria-label^=\"NQ1 Index: \"]"]], ["27F MON", ["[role=\"grid\"]:not([aria-rowcount=\"1\"])"]], ["volmanaged_v0 EQ", ["ul[aria-label^=\"Key figures for \"] .kpi-value", "[role=\"img\"]"]], ["REG", ["[role=\"grid\"]:not([aria-rowcount=\"1\"])"]]];
  const marked = new Set();
  const mark = (n) => { if (!marked.has(n)) { marked.add(n); performance.mark(n); } };
  const markRaf = (n) => { if (marked.has(n)) return; marked.add(n); let done = false; requestAnimationFrame(() => requestAnimationFrame(() => { done = true; performance.mark(n); })); setTimeout(() => { if (!done) performance.mark(n + ':timer'); }, 400); };
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

(() => {
  if (window.__t2Health) return;
  const h = window.__t2Health = { raf: 0, ticks: 0, t0: performance.now() };
  const loop = () => { h.raf++; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  setInterval(() => { h.ticks++; }, 100);
})();
