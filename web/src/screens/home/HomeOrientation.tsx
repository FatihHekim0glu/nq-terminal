// The first-run orientation line for HOME (N03, polish 3): HOME opens on a dense grid with twenty-odd labels and
// no signpost, so this one line answers three questions (what passed, what is the evidence, where is the audit
// trail) and points to HELP. `{REG <GO>}` and the others are command links. It shows on a viewer's first run and on
// every load of the demo, and goes on a click of Dismiss or on Esc. Esc is heard in the capture phase, because the
// command line (where focus is on load) stops that key for itself; it is never stopped or prevented here, so the
// command line still cancels its step. That a viewer has dismissed it is remembered per viewer in storage that may be missing, full or
// blocked: every access is guarded, and a failure only means it shows again. The strip reads nothing from the API.
// Mount it lazily under the message line (`lazy(() => import('./screens/home/HomeOrientation'))`), on HOME only.
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { KeyText } from '../../chrome/MessageLine'
import { HOME_ORIENTATION } from '../../copy/home'
import { safeLocalStorage, type SafeStorage } from '../../state/safeStorage'
import CommandLink from '../help/CommandLink'
import './home.css'

/** The storage key of a viewer who has dismissed the line (nqt.* like every other per-viewer key). */
export const ORIENTATION_KEY = 'nqt.orientation'
const DISMISSED = '1'
const COMMAND_LINK = /(\{[^{}]+\})/

export interface HomeOrientationProps {
  /** Where the dismissal is remembered; the page's localStorage by default. */
  readonly storage?: SafeStorage
  /** Whether this is the demo build (always shown); read from the page's data-demo flag by default. */
  readonly demo?: boolean
}

function pageIsDemo(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset['demo'] === 'on'
}

/** A piece of copy with its `{line <GO>}` parts as command links and the rest as key-coloured text. */
function Piece({ text }: { readonly text: string }): ReactNode {
  return (
    <>
      {text.split(COMMAND_LINK).map((part, i) =>
        COMMAND_LINK.test(part) ? <CommandLink key={i} text={part} /> : <KeyText key={i} text={part} />,
      )}
    </>
  )
}

export default function HomeOrientation({ storage = safeLocalStorage, demo = pageIsDemo() }: HomeOrientationProps) {
  const [open, setOpen] = useState(() => demo || storage.read(ORIENTATION_KEY) !== DISMISSED)
  const dismiss = useCallback(() => {
    storage.write(ORIENTATION_KEY, DISMISSED)
    setOpen(false)
  }, [storage])

  // Another window, or the workspace store's first read, recorded the dismissal: close the line here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if ((e.key === null || e.key === ORIENTATION_KEY) && !demo && storage.read(ORIENTATION_KEY) === DISMISSED) setOpen(false)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [demo, storage])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) dismiss()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, dismiss])

  if (!open) return null
  const pieces = [HOME_ORIENTATION.passed, HOME_ORIENTATION.evidence, HOME_ORIENTATION.audit, HOME_ORIENTATION.glossary, ...(demo ? [HOME_ORIENTATION.demo] : [])]
  return (
    <aside className="home-orient" role="note" aria-label={HOME_ORIENTATION.label}>
      <p className="home-orient-text">
        <span className="home-orient-lead">{HOME_ORIENTATION.lead}</span>
        {pieces.map((text) => (
          <Fragment key={text}>
            {' '}
            <Piece text={text} />
          </Fragment>
        ))}
      </p>
      <button type="button" className="home-orient-dismiss" aria-label={HOME_ORIENTATION.dismissLabel} onClick={dismiss}>
        <KeyText text={HOME_ORIENTATION.dismiss} />
      </button>
    </aside>
  )
}
