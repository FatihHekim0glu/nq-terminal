// Same logic as installHomeProbe in web/e2e/perf/pages.ts (copied, not imported).
(function () {
  if (window.__nqProbe) return; window.__nqProbe = true;
  var ready = [
    ['NQ GP 1d', ['[role="img"][aria-label^="NQ1 Index: "]']],
    ['27F MON', ['[role="grid"]:not([aria-rowcount="1"])']],
    ['volmanaged_v0 EQ', ['ul[aria-label^="Key figures for "] .kpi-value', '[role="img"]']],
    ['REG', ['[role="grid"]:not([aria-rowcount="1"])']]
  ];
  var marked = {};
  function markAfterPaint(name) {
    if (marked[name]) return; marked[name] = true;
    // rAF twice, as the e2e probe does; a timer fallback records whether rAF ever ran (hidden windows may not paint)
    var done = false;
    requestAnimationFrame(function () { requestAnimationFrame(function () { done = true; performance.mark(name); }); });
    setTimeout(function () { if (!done) performance.mark(name + ':timer'); }, 400);
  }
  function panelOk(p) {
    var el = document.querySelector('[data-nqt-title="' + p[0] + '"]');
    return el !== null && p[1].every(function (s) { return el.querySelector(s) !== null; });
  }
  function check() {
    if (document.querySelectorAll('[data-nqt-title]').length >= ready.length) markAfterPaint('nqt:home-frame');
    var loading = document.querySelector('p.ws-empty') !== null;
    var chartBusy = document.querySelector('[aria-busy="true"]:not(td):not([role="gridcell"])') !== null;
    if (!loading && !chartBusy && ready.every(panelOk)) markAfterPaint('nqt:home-ready');
    if (marked['nqt:home-ready'] && document.querySelector('[aria-busy="true"]') === null) markAfterPaint('nqt:home-settled');
  }
  var obs = new MutationObserver(check);
  function start() { obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); check(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
