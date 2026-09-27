// @vitest-environment jsdom
// A screen with tabs (RUN, the tear sheet) owns one 98) Export; the shown tab says what it holds. The
// tab registers its CSV while mounted; with none registered, Export says there is nothing to save.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { EXPORT } from '../copy/workspace'
import { captureDownloads } from './download.testUtil'
import { ExportSlotProvider, useExportSlot, useExportSource, type ExportSource } from './exportSource'
import { useMessage } from './MessageLine.store'

afterEach(cleanup)

function Tab({ source }: { readonly source: ExportSource | null }) {
  useExportSource(source)
  return <p>tab</p>
}

function Screen() {
  const slot = useExportSlot()
  const [tab, setTab] = useState<'a' | 'b' | 'none'>('a')
  const sources: Record<string, ExportSource | null> = {
    a: { fileName: 'a.csv', csv: 'x\r\n1', rows: 1 },
    b: { fileName: 'b.csv', csv: 'y\r\n2\r\n3', rows: 2 },
    none: null,
  }
  return (
    <ExportSlotProvider slot={slot}>
      <button type="button" onClick={() => slot.run()}>export</button>
      <button type="button" onClick={() => setTab('b')}>tab b</button>
      <button type="button" onClick={() => setTab('none')}>tab none</button>
      <Tab key={tab} source={sources[tab] ?? null} />
    </ExportSlotProvider>
  )
}

describe('export slot', () => {
  it('saves what the shown tab registered, and follows the tab', async () => {
    const saved = captureDownloads()
    try {
      render(<Screen />)
      fireEvent.click(screen.getByText('export'))
      expect(await saved.text()).toBe('x\r\n1')
      fireEvent.click(screen.getByText('tab b'))
      fireEvent.click(screen.getByText('export'))
      expect(saved.files.map((f) => f.name)).toEqual(['a.csv', 'b.csv'])
      fireEvent.click(screen.getByText('tab none'))
      fireEvent.click(screen.getByText('export'))
      expect(saved.files).toHaveLength(2)
      expect(useMessage.getState().text).toBe(EXPORT.empty)
    } finally {
      saved.restore()
    }
  })
})
