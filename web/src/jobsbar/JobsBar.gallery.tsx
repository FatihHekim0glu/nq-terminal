// Gallery entry /__gallery/JobsBar (release 0.2.0): the global job indicator and one anchor re-run control, reading
// the job list and run detail from the page's backend. The launcher is a stand-in that answers a job without any
// request (the E2E run is GET only), and the line the indicator or the control sends to the command line is shown
// under them, so the run can check what Open in RUN would type.
import { useEffect, useState } from 'react'
import { onLineRequest } from '../chrome/CommandLine.bus'
import AnchorRerun from './AnchorRerun'
import { AnchorLauncherContext, type AnchorLauncher } from './anchorRerun.store'
import JobIndicator from './JobIndicator'

const BASE = 't_base'
const standIn: AnchorLauncher = async (baseRunId) => ({ id: 'j-anchor', run_id: `${baseRunId}_regress_r1` })

export default function JobsBarGallery() {
  const [opened, setOpened] = useState('')
  useEffect(() => onLineRequest((request) => setOpened(request.line)), [])
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <JobIndicator />
      <div style={{ padding: '0 8px' }}>
        <AnchorLauncherContext value={standIn}>
          <AnchorRerun baseRunId={BASE} />
        </AnchorLauncherContext>
      </div>
      <p data-testid="opened" style={{ padding: '0 8px' }}>{`Opened line: ${opened}`}</p>
    </div>
  )
}
