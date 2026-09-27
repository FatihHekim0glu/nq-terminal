// One pivot grid's table and viewer set-up (TASKS 9.1), kept apart from the React component so its
// lifecycle is testable without the engine. The engine is a page-wide singleton that may still be
// starting when the grid unmounts, so every await is followed by a check that the grid is still mounted:
// no table is made for a grid that has gone, and a table made before the grid went is deleted here,
// because the component's cleanup has already run and never sees it. On success the caller owns the table.
import type { PivotPreset } from './datasets'
import type { PspColumnar, PspSchema } from './schema'

export interface MountViewerElement {
  load(client: unknown): Promise<unknown>
  restore(config: Readonly<Record<string, unknown>>): Promise<unknown>
  flush(): Promise<unknown>
}

export interface TableHandle {
  update(data: PspColumnar): Promise<unknown>
  delete(): Promise<unknown>
}

export interface MountEngine {
  readonly client: { table(schema: PspSchema, options: { name: string }): Promise<unknown> }
}

export interface MountProps {
  /** What the grid holds, for the viewer title. */
  readonly name: string
  readonly schema: PspSchema
  readonly data: PspColumnar
  readonly preset: PivotPreset
}

export interface PivotTiming {
  /** Engine start in this mount (0 when it was already running). */
  readonly engineMs: number
  /** From the rows in hand to the grid painted: table, load, restore and flush. */
  readonly loadMs: number
}

export interface Mounted {
  readonly table: TableHandle
  readonly timing: PivotTiming
}

let tableSerial = 0

function viewerConfig(table: string, title: string, preset: PivotPreset): Record<string, unknown> {
  return {
    table,
    title,
    plugin: 'Datagrid',
    settings: false,
    columns: [...preset.columns],
    group_by: [...(preset.group_by ?? [])],
    split_by: [...(preset.split_by ?? [])],
    sort: (preset.sort ?? []).map(([c, d]) => [c, d]),
    aggregates: { ...(preset.aggregates ?? {}) },
    columns_config: { ...(preset.columns_config ?? {}) },
  }
}

function dropTable(table: TableHandle): void {
  void table.delete().catch(() => undefined)
}

/** Makes the grid's table and shows it; null when the grid unmounted first (nothing is left behind). */
export async function mountViewer(
  viewer: MountViewerElement,
  props: MountProps,
  alive: () => boolean,
  load: () => Promise<MountEngine>,
): Promise<Mounted | null> {
  const asked = performance.now()
  const engine = await load()
  if (!alive()) return null
  const engineMs = performance.now() - asked
  const loadStart = performance.now()
  tableSerial += 1
  const name = `nqt-pivot-${tableSerial}`
  const table = (await engine.client.table({ ...props.schema }, { name })) as TableHandle
  try {
    if (alive()) await table.update(props.data)
    if (!alive()) {
      dropTable(table)
      return null
    }
    await viewer.load(engine.client)
    await viewer.restore(viewerConfig(name, props.name, props.preset))
    await viewer.flush()
  } catch (error: unknown) {
    dropTable(table)
    throw error
  }
  return { table, timing: { engineMs, loadMs: performance.now() - loadStart } }
}

/** A viewer element as the cleanup sees it: upgraded (with delete) or, when the engine never started, plain. */
export interface ReleasableViewer {
  remove(): void
  delete?: () => Promise<unknown>
}

/**
 * Tears one grid down and never throws: deletes the viewer when it was upgraded (a viewer whose engine could not
 * start is a plain element with no delete method), removes it, then deletes the grid's table if one was made.
 * A cleanup that threw here would take the whole panel down in React, fallback table included.
 */
export async function releaseViewer(viewer: ReleasableViewer, table: TableHandle | null): Promise<void> {
  try {
    if (typeof viewer.delete === 'function') await viewer.delete()
  } catch {
    // The viewer is going either way; its own teardown error changes nothing here.
  }
  viewer.remove()
  await table?.delete().catch(() => undefined)
}

/** `promise`, or a rejection with `message` if it has not settled within `ms` (the timer is cleared either way). */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
