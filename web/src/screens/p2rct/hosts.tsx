// The three P2 cards with their read states (TASKS Phase 12): each takes the `{ data, error }` of its query, shows the
// card's own pending or failed line until the response arrives, then the panel. The hooks that fetch live with the
// other tear and market hooks (tearQueries.ts and queries.screens.ts); a host only reads what it is given.
import type { ApiError } from '../../api/client'
import { RCT } from '../../copy/regimesCapacityTerm'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import { Card, Pending } from '../tear/TearCard'
import CapacityPanel from './CapacityPanel'
import TermStructurePanel from './TermStructurePanel'
import TrendRegimePanel from './TrendRegimePanel'
import type { RunCapacity, TermStructure, TrendRegimeView } from './types'

export interface ReadState<T> {
  readonly data: T | undefined
  readonly error: ApiError | null
}

function Waiting({ title, error }: { readonly title: string; readonly error: ApiError | null }) {
  return (
    <Card title={title} className="rct-card">
      <Pending error={error} failed={RCT.failed} loading={RCT.loading} />
    </Card>
  )
}

export function TrendRegimeHost({ query, link }: { readonly query: ReadState<TrendRegimeView>; readonly link?: PanelLink }) {
  if (!query.data) return <Waiting title={RCT.trend.title} error={query.error} />
  return <TrendRegimePanel view={query.data} link={link} />
}

export function CapacityHost({ query }: { readonly query: ReadState<RunCapacity> }) {
  if (!query.data) return <Waiting title={RCT.capacity.title} error={query.error} />
  return <CapacityPanel capacity={query.data} />
}

export function TermStructureHost({ root, query, link }: { readonly root: string; readonly query: ReadState<TermStructure>; readonly link?: PanelLink }) {
  if (!query.data) return <Waiting title={fillCopy(RCT.term.title, { root })} error={query.error} />
  return <TermStructurePanel term={query.data} link={link} />
}
