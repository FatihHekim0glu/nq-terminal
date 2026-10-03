// Completeness of the heavy set (bench_browser.run_once step for step). A run whose heavy set had any step or panel error
// is not a D0.2 heavy-set reading: its memory after the set is a lower bound, so it must not feed the heavy-set median.

// Returns [{ step, where, error }] for every step that carries an error and every docked panel that carries one.
export function heavyErrors(steps) {
  const out = []
  for (const s of steps ?? []) {
    if (s.error) out.push({ step: s.step, where: s.step, error: String(s.error).slice(0, 200) })
    for (const p of Array.isArray(s.panels) ? s.panels : []) if (p && p.error) out.push({ step: s.step, where: p.line, error: String(p.error).slice(0, 200) })
  }
  return out
}

export const heavyComplete = (r) => heavyErrors(r?.steps).length === 0
