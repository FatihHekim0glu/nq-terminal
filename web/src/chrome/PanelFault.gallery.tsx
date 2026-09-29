// Gallery entry /__gallery/PanelFault (roadmap #7): the three fault states, backend free. The waiting
// case sets the connection store to down for the gallery's fixed clock only, and puts it back on
// unmount so it never leaks into another gallery entry.
import { useEffect } from 'react'
import { ApiError } from '../api/client'
import { connectionStore, DOWN_AFTER, INITIAL_CONNECTION, resetConnection } from '../api/connection'
import { MARKET } from '../copy/market'
import PanelFault from './PanelFault'
import './PanelFault.css'

const DOWN_AT = Date.parse('2021-12-01T14:00:00Z')

const FAILED_ERROR = new ApiError({
  kind: 'http',
  path: '/api/hypotheses/overnight_v0',
  status: 500,
  body: { detail: 'disk read failed' },
  detail: 'disk read failed',
})
const REFUSED_ERROR = new ApiError({
  kind: 'http',
  path: '/api/bars',
  status: 403,
  body: { detail: 'window leaves the in-sample window' },
  detail: 'window leaves the in-sample window',
})
const WAITING_ERROR = new ApiError({ kind: 'http', path: '/api/bars?symbol=NQ', status: 502, body: null, detail: '502' })

function useFixtureDown(): void {
  useEffect(() => {
    connectionStore.setState(
      { ...INITIAL_CONNECTION, status: 'down', failures: DOWN_AFTER, downSince: DOWN_AT, lastCheckAt: DOWN_AT },
      true,
    )
    return () => resetConnection()
  }, [])
}

const CASES = [
  ['failed', FAILED_ERROR, true],
  ['refused', REFUSED_ERROR, false],
  ['waiting', WAITING_ERROR, false],
] as const

export default function PanelFaultGallery() {
  useFixtureDown()
  return (
    <section className="panel-fault-gallery" aria-labelledby="panel-fault-title">
      <h2 id="panel-fault-title">PanelFault</h2>
      {CASES.map(([key, error, withRetry]) => (
        <div key={key}>
          <h3>{key}</h3>
          <PanelFault error={error} failedText={MARKET.failed} onRetry={withRetry ? () => undefined : undefined} />
        </div>
      ))}
    </section>
  )
}
