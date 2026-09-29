// Number <GO> (spec 5.1 item 5): a per-panel registry of numbered actions. A panel (its grid rows, its
// red-bar menu buttons, the HELP index) registers the items it shows with their numbers; `N <Enter>` in
// the command line runs item N of the focused panel. Several registrations per panel may coexist; the
// latest wins a clash. Every registration is copied and frozen, and the registry itself is replaced,
// never changed in place.

export interface NumberedItem {
  readonly n: number
  readonly label: string
  readonly run: () => void
}

interface Registration {
  readonly items: ReadonlyArray<NumberedItem>
}

// Module state on purpose: one registry shared by every panel and by the command line, read outside
// React. It is only ever replaced whole (withPanel builds a new Map), never changed in place; keep
// every write in this file.
let registry: ReadonlyMap<string, ReadonlyArray<Registration>> = new Map()

function withPanel(panelId: string, regs: ReadonlyArray<Registration>): ReadonlyMap<string, ReadonlyArray<Registration>> {
  const next = new Map(registry)
  if (regs.length === 0) next.delete(panelId)
  else next.set(panelId, regs)
  return next
}

/** Registers `items` for `panelId`; returns the function that removes this registration only. */
export function registerNumbered(panelId: string, items: ReadonlyArray<NumberedItem>): () => void {
  const reg: Registration = Object.freeze({ items: Object.freeze(items.map((i) => Object.freeze({ ...i }))) })
  registry = withPanel(panelId, [...(registry.get(panelId) ?? []), reg])
  return () => {
    registry = withPanel(panelId, (registry.get(panelId) ?? []).filter((r) => r !== reg))
  }
}

/** Every item a panel shows, the latest registration winning a number, sorted by number. */
export function numberedItems(panelId: string): ReadonlyArray<NumberedItem> {
  const byNumber = new Map<number, NumberedItem>()
  for (const reg of registry.get(panelId) ?? []) for (const item of reg.items) byNumber.set(item.n, item)
  return [...byNumber.values()].sort((a, b) => a.n - b.n)
}

// The panel whose numbered item is running right now (G03). An item is a known panel's own action, so the
// line it asks the command line to run belongs to that panel, and the workspace plans it there (replace, or
// a new panel beside it) even when no panel has real focus, as after a layout load. Set for the length of
// one run() only, so a typed line never sees it.
let running: string | null = null

/** The panel whose numbered item is running now, or null (always null outside `activateNumbered`). */
export function runningPanel(): string | null {
  return running
}

/** Runs item `n` of the panel; false (and nothing run) when the panel has no such item. */
export function activateNumbered(panelId: string, n: number): boolean {
  if (!Number.isInteger(n) || n < 1) return false
  const item = numberedItems(panelId).find((i) => i.n === n)
  if (!item) return false
  const outer = running
  running = panelId
  try {
    item.run()
  } finally {
    running = outer
  }
  return true
}

/** Drops every registration (tests). */
export function resetNumbered(): void {
  registry = new Map()
}
