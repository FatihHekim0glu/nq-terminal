// axe-core over the finished self-test page, with the WCAG 2.0 to 2.2 A and AA rule sets (AXE_TAGS) the project's browser specs
// use. This runs inside the page, so it is axe in the engine the app runs in (WebView2 here, WKWebView on a Mac). axe-core
// loads only now, as its own chunk, and only in a self-test build.
import type { Result as AxeResult } from 'axe-core'
import { AXE_TAGS, type AxeReport, type AxeViolation } from './report.ts'

const TARGETS_PER_RULE = 3

/** A rule result (a violation or an undecided check) as the report keeps it: the rule, how many elements, the first few. */
function toFinding(v: AxeResult): AxeViolation {
  return {
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, TARGETS_PER_RULE).map((n) => n.target.join(' ')),
  }
}

export async function runAxe(root: Document = document): Promise<AxeReport> {
  const axe = (await import('axe-core')).default
  const results = await axe.run(root, { runOnly: { type: 'tag', values: [...AXE_TAGS] } })
  return {
    version: axe.version,
    tags: [...AXE_TAGS],
    violations: results.violations.map(toFinding),
    passes: results.passes.length,
    incomplete: results.incomplete.length,
    incompleteRules: results.incomplete.map(toFinding),
  }
}
