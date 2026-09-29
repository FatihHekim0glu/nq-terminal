// The equity box of DES (UI_SPEC section 7 "DES": series equity at the chosen cost, Basis A, with its
// benchmark). The curve and the benchmark are the API's own arrays (GET /api/analytics/hypothesis/{name}/panel),
// passed to LineStack unchanged; the panel is terminal-computed, so it carries its [POST HOC] tag and the
// "descriptive, in-sample, not a registered test" label, with its unit and benchmark named. Costs are only
// the ones the screen recorded.
import { useMemo, useState } from 'react'
import { useApiQuery } from '../../api/queries'
import LineStack from '../../charts/LineStack'
import { ToggleGroup } from '../../chrome/Field.buttons'
import { usePanelSource } from '../../chrome/panelSources'
import type { PanelLink } from '../../state/linkGroups'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { panelDrawdown } from '../home/homeEquity.model'
import { decimalsFor, defaultCost, ticksLabel, type HypothesisCard } from './desModel'
import { desEquityProvenance } from './desGrab'
import { LoadError, Status } from './DesParts'

export interface DesEquityProps {
  readonly card: HypothesisCard
  readonly link: PanelLink
}

function usePanel(name: string, cost: number | null) {
  return useApiQuery(
    '/api/analytics/hypothesis/{name}/panel',
    { path: { name }, query: { cost: cost ?? undefined } },
    { enabled: cost !== null && name !== '' },
  )
}

export default function DesEquity({ card, link }: DesEquityProps) {
  const [cost, setCost] = useState<number | null>(() => defaultCost(card))
  const query = usePanel(card.name, cost)
  const data = query.data
  // What this chart's numbers came from, for GRAB's caption (roadmap 15): the terminal's own panel answer
  // ([POST HOC], its unit, its GET), not the card. Registered once the answer is in; the page's own
  // registration (HypothesisDes) stays null on Profile so it never shadows this one.
  usePanelSource(useMemo(() => (data && cost !== null ? { provenance: desEquityProvenance(card, data, cost) } : null), [card, data, cost]))
  const panes = useMemo(() => {
    if (!data) return null
    const bench = data.bench_label && data.bench_equity ? { name: data.bench_label, values: data.bench_equity } : null
    const dd = panelDrawdown(data)
    return [{
      id: 'equity',
      zero: 'white' as const,
      ...(dd ? { summaryDrawdown: dd } : {}),
      decimals: decimalsFor([...data.equity, ...(bench?.values ?? [])]),
      series: [
        { name: card.name, style: 'primary' as const, values: data.equity },
        ...(bench ? [{ name: bench.name, style: 'benchmark' as const, values: bench.values }] : []),
      ],
    }]
  }, [data, card.name])
  if (cost === null) return <p className="des-note">{DES.equityNone}</p>
  const options = card.series_costs.map((c) => ({ value: String(c), label: ticksLabel(c) }))
  return (
    <div className="des-equity">
      <div className="des-equity-bar">
        <ToggleGroup label={DES.equityCost} options={options} value={String(cost)} onChange={(v) => setCost(Number(v))} />
      </div>
      {query.isPending ? <Status>{fillCopy(DES.loading, { name: card.name })}</Status> : null}
      {query.isError ? <LoadError name={card.name} error={query.error} /> : null}
      {data && panes ? (
        <>
          <div className="des-equity-chart">
            <LineStack
              title={fillCopy(DES.equityChart, { name: card.name, cost: ticksLabel(cost) })}
              t={data.t}
              panes={panes}
              link={link}
              initialRange="Max"
            />
          </div>
          <p className="des-note">
            <span className="des-tag">{data.tag}</span> {DES.equityDescriptive}
          </p>
          <p className="des-note">{data.label}</p>
          <p className="des-note">{fillCopy(DES.equityUnit, { unit: data.equity_unit })}</p>
          {data.bench_label ? <p className="des-note">{fillCopy(DES.equityBench, { bench: data.bench_label })}</p> : null}
        </>
      ) : null}
    </div>
  )
}
