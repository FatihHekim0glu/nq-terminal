// One 98) Export for a screen with tabs (RUN, the tear sheet): the screen owns an export slot and its
// red-bar button; the shown tab registers what it holds (a file name, the CSV and its row count) while
// it is mounted, so Export always saves the tab on screen. Nothing registered: Export says so.
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { exportCsv } from './exportCsv'
import { postMessage } from './MessageLine.store'
import { EXPORT } from '../copy/workspace'

export interface ExportSource {
  readonly fileName: string
  readonly csv: string
  readonly rows: number
}

export interface ExportSlot {
  /** Saves the registered source; false (with the reason on the message line) when there is none. */
  run(): boolean
  /** Registers `source`; returns the function that removes this registration only. */
  register(source: ExportSource | null): () => void
}

export function useExportSlot(): ExportSlot {
  const current = useRef<ExportSource | null>(null)
  return useMemo<ExportSlot>(
    () => ({
      run: () => {
        const source = current.current
        if (!source) {
          postMessage(EXPORT.empty)
          return false
        }
        return exportCsv(source.fileName, source.csv, source.rows)
      },
      register: (source) => {
        current.current = source
        return () => {
          if (current.current === source) current.current = null
        }
      },
    }),
    [],
  )
}

const SlotContext = createContext<ExportSlot | null>(null)

export function ExportSlotProvider({ slot, children }: { readonly slot: ExportSlot; readonly children: ReactNode }) {
  return <SlotContext value={slot}>{children}</SlotContext>
}

/** Registers what this tab would export while it is mounted (keep `source` stable with useMemo). */
export function useExportSource(source: ExportSource | null): void {
  const slot = useContext(SlotContext)
  useEffect(() => (slot ? slot.register(source) : undefined), [slot, source])
}
