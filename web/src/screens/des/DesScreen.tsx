// DES (TASKS 6.2; UI_SPEC sections 5 and 7; look spec 7.3): one screen, three views chosen by the panel's
// context. A hypothesis context that names a sealed-window confirmation shows the confirmation ([SPENT]);
// any other hypothesis context shows the hypothesis tear sheet; an instrument shows its description; no
// context shows how to give one. The confirmation list is read first, so a confirmation is never asked for
// as a registry row.
import { useRef } from 'react'
import { useConfirmations } from '../../api/queries'
import { usePanelPage } from '../../chrome/PanelChrome.page'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import type { PanelLink } from '../../state/linkGroups'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import ConfirmationDes from './ConfirmationDes'
import { DesEmpty, Status } from './DesParts'
import HypothesisDes from './HypothesisDes'
import InstrumentDes from './InstrumentDes'
import { findConfirmation } from './desModel'

function HypothesisRoute({ name, link }: { readonly name: string; readonly link: PanelLink }) {
  const confirmations = useConfirmations()
  if (confirmations.isPending) return <Status>{fillCopy(DES.loading, { name })}</Status>
  // Without the list the terminal cannot tell a confirmation from a registry row: say so, and never
  // ask /api/hypotheses for a name that may be a sealed-window confirmation.
  if (confirmations.isError) {
    return (
      <p className="des-status des-error" role="alert">
        {fillCopy(DES.confirmationsError, { name, detail: confirmations.error.detail })}
      </p>
    )
  }
  const confirmation = findConfirmation(name, confirmations.data)
  if (confirmation) return <ConfirmationDes confirmation={confirmation} />
  return <HypothesisDes name={name} link={link} />
}

function Empty() {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  return (
    <div ref={ref}>
      <DesEmpty page={page} />
    </div>
  )
}

export default function DesScreen({ params, context }: ScreenProps) {
  if (context?.kind === 'instrument') return <InstrumentDes key={context.value} root={context.value} link={params.group} />
  if (context?.kind === 'hypothesis') return <HypothesisRoute key={context.value} name={context.value} link={params.group} />
  return <Empty />
}
