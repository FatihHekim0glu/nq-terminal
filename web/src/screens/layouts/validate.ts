// Checks on a default layout, so a broken table fails a test instead of a panel: unique ids, a first
// panel without a position and every later panel placed against an earlier one, known functions and
// link groups, a context each function accepts (none for a function that takes none, one for a
// linked function that needs one), and a valid argument. Pure; returns readable problems.
import type { LayoutPanel, ScreenLayout } from '../../chrome/WorkspaceLayouts'
import { TIMEFRAMES, findMnemonic, type MnemonicDef } from '../../commands/registry'

const GROUPS: ReadonlySet<string> = new Set(['A', 'B', 'C', '-'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function argumentOk(def: MnemonicDef, panel: LayoutPanel): boolean {
  const { date, timeframe } = panel.args
  if (def.argument === 'none') return date === undefined && timeframe === undefined
  if (def.argument === 'date') return timeframe === undefined && (date === undefined || ISO_DATE.test(date))
  return date === undefined && (timeframe === undefined || (TIMEFRAMES as readonly string[]).includes(timeframe))
}

function contextProblems(name: string, def: MnemonicDef, panel: LayoutPanel): string[] {
  const where = `${name}: panel ${panel.id} (${def.code})`
  if (panel.context && !def.accepts.includes(panel.context.kind)) return [`${where} does not take a ${panel.context.kind} context`]
  if (!panel.context && panel.group !== '-' && def.accepts.length > 0) return [`${where} is in link group ${panel.group} with no context`]
  return []
}

function panelProblems(layout: ScreenLayout, panel: LayoutPanel, index: number): string[] {
  const name = layout.screen
  const problems: string[] = []
  if (index === 0 && panel.position) problems.push(`${name}: the first panel ${panel.id} has a position`)
  if (index > 0 && !panel.position) problems.push(`${name}: panel ${panel.id} has no position`)
  const earlier = layout.panels.slice(0, index).map((p) => p.id)
  if (index > 0 && panel.position && !earlier.includes(panel.position.ref)) {
    problems.push(`${name}: panel ${panel.id} refers to ${panel.position.ref}, which is not an earlier panel`)
  }
  if (!GROUPS.has(panel.group)) problems.push(`${name}: panel ${panel.id} has an unknown link group ${panel.group}`)
  const def = findMnemonic(panel.code)
  if (!def || def.code !== panel.code) return [...problems, `${name}: panel ${panel.id} has an unknown function ${panel.code}`]
  if (!argumentOk(def, panel)) problems.push(`${name}: panel ${panel.id} (${def.code}) has a bad argument`)
  return [...problems, ...contextProblems(name, def, panel)]
}

/** Every problem with `layout`; an empty list when it is sound. */
export function layoutProblems(layout: ScreenLayout): string[] {
  if (layout.panels.length === 0) return [`${layout.screen}: no panels`]
  const seen = new Set<string>()
  const repeats = layout.panels.flatMap((p) => {
    const repeat = seen.has(p.id)
    seen.add(p.id)
    return repeat ? [`${layout.screen}: panel id ${p.id} repeats`] : []
  })
  return [...repeats, ...layout.panels.flatMap((p, i) => panelProblems(layout, p, i))]
}
