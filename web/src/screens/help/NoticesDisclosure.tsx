// The third-party notices as an in-page disclosure. The desktop shell denies every new window except the chart
// library's attribution link, so a target=_blank link to the notices file did nothing there; the file is fetched
// same-origin and shown in a labelled, focusable region instead (works the same in a browser). The read is the client's
// fetchAsset, the one GET for a build's own static file; this module never calls fetch itself (api/client.test.ts).
import { useId, useRef, useState } from 'react'
import { fetchAsset } from '../../api/client'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { HELP } from '../../copy/help'

const roving = { [ROVING_ATTR]: '' }

type Load = { readonly state: 'idle' } | { readonly state: 'loading' } | { readonly state: 'failed' } | { readonly state: 'ready'; readonly text: string }

async function fetchNotices(): Promise<string> {
  const res = await fetchAsset(new URL(HELP.noticesUrl, document.baseURI).href)
  return res.text()
}

export default function NoticesDisclosure() {
  const regionId = useId()
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState<Load>({ state: 'idle' })
  const started = useRef(false)

  const start = () => {
    started.current = true
    setLoad({ state: 'loading' })
    fetchNotices().then(
      (text) => setLoad({ state: 'ready', text }),
      () => {
        started.current = false
        setLoad({ state: 'failed' })
      },
    )
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !started.current) start()
  }

  return (
    <>
      <p>
        <button type="button" className="cmd-link" aria-expanded={open} aria-controls={regionId} onClick={toggle} {...roving}>
          {HELP.noticesLink}
        </button>
      </p>
      <div>
        {open && load.state === 'loading' && <p role="status" className="muted">{HELP.noticesLoading}</p>}
        {open && load.state === 'failed' && <p role="alert">{HELP.noticesFailed}</p>}
        {open && load.state === 'ready' && (
          <pre id={regionId} className="help-notices" role="region" aria-label={HELP.noticesRegion} tabIndex={0}>{load.text}</pre>
        )}
      </div>
    </>
  )
}
