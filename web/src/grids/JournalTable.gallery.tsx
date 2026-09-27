// Gallery entry /__gallery/JournalTable (TASKS 5.4 acceptance: "plumbing row shows the exact banner
// text"): November 2021 fixture rows from the paper book journal and the plumbing journal, newest
// first; plumbing rows hatched with the banner, a refused close and a skipped session among them.
import { useMemo, useState } from 'react'
import { GRID_GALLERY as G } from '../copy/grids'
import { fillCopy } from '../copy/workspace'
import { journalRows } from './gallery.fixtures'
import JournalTable from './JournalTable'
import './grids.gallery.css'

const FILES = 'volmanaged_paper_journal.jsonl, volmanaged_paper_journal.PLUMBING_DELAYED.jsonl'

export default function JournalTableGallery() {
  const rows = useMemo(() => journalRows(), [])
  const [opened, setOpened] = useState<string | null>(null)
  return (
    <section className="grid-gallery" aria-labelledby="jt-title">
      <h2 id="jt-title">{G.journalTitle}</h2>
      <div className="grid-gallery-body">
        <JournalTable rows={rows} file={FILES} onOpen={(r) => setOpened(`${r.file}:${r.line_no}`)} />
      </div>
      <p className="grid-gallery-readout" role="status" data-testid="opened">
        {opened === null ? G.openedNone : fillCopy(G.opened, { name: opened })}
      </p>
    </section>
  )
}
