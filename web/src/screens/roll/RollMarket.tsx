// One market's rolls (ANALYTICS MV10, gaps as MV2): a market picker, the summary with the universe QA report's count beside
// ours, the gap chart and the table of rolls (dates, the vendor instrument ids before and after, the raw close
// before the roll, the gap in points at the tick's precision and in percent). Rolls dated after 2021-12-31 are
// never shown; if the API ever sent one, a note says how many were left out.
import { useMemo } from 'react'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { CONTRACT_NAMES } from '../../copy/market'
import { ROLL } from '../../copy/roll'
import { fillCopy } from '../../copy/workspace'
import GapChart from './GapChart'
import { formatPct, formatPts, gapChart, qaText, shownRolls, summaryText } from './model'
import type { MarketRolls, RollCalendar } from './types'

function RollsTable({ market }: { readonly market: MarketRolls }) {
  const { rolls } = shownRolls(market)
  const C = ROLL.rollCols
  return (
    <div className="nqt-grid-scroll roll-table-wrap">
      <table className="nqt-grid roll-table" data-testid="roll-table">
        <caption className="roll-note">{fillCopy(ROLL.rollsCaption, { root: market.root })}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">{C.n}</th>
            <th scope="col">{C.date}</th>
            <th scope="col">{C.lastDate}</th>
            <th scope="col" className="num">{C.from}</th>
            <th scope="col" className="num">{C.to}</th>
            <th scope="col" className="num">{C.close}</th>
            <th scope="col" className="num">{C.gapPts}</th>
            <th scope="col" className="num">{C.gapPct}</th>
          </tr>
        </thead>
        <tbody>
          {rolls.map((r, i) => (
            <tr key={r.t}>
              <td className="num muted">{i + 1}</td>
              <td className="time">{r.date}</td>
              <td className="time">{r.last_date}</td>
              <td className="num">{r.from}</td>
              <td className="num">{r.to}</td>
              <td className="num">{r.close_before === null ? ROLL.missingValue : String(r.close_before)}</td>
              <td className={`num ${(r.gap_pts ?? 0) >= 0 ? 'up' : 'down'}`}>{formatPts(r.gap_pts, market.tick)}</td>
              <td className={`num ${(r.gap_pct ?? 0) >= 0 ? 'up' : 'down'}`}>{formatPct(r.gap_pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export interface RollMarketProps {
  readonly calendar: RollCalendar
  readonly symbol: string
  readonly onSymbol: (symbol: string) => void
}

export default function RollMarket({ calendar, symbol, onSymbol }: RollMarketProps) {
  const market = calendar.markets.find((m) => m.symbol === symbol) ?? calendar.markets[0]
  const options = useMemo(
    () => calendar.markets.map((m) => ({ value: m.symbol, label: `${m.root} ${CONTRACT_NAMES[m.root] ?? ''}`.trim() })),
    [calendar.markets],
  )
  const chart = useMemo(() => (market ? gapChart(market) : null), [market])
  if (!market || !chart) return null
  return (
    <div className="roll-market">
      <ParamRow label={ROLL.paramMarket}>
        <DropdownField label={ROLL.market} value={market.symbol} options={options} onChange={onSymbol} />
        <ReadOnlyValue label={ROLL.asOf}>{calendar.as_of}</ReadOnlyValue>
      </ParamRow>
      <p className="roll-note">{summaryText(market)}</p>
      <p className={market.qa_match === false ? 'roll-note mkt-warn-text' : 'roll-note'}>{qaText(market)}</p>
      {chart.fenced > 0 ? <p className="roll-note mkt-warn-text">{fillCopy(ROLL.fenced, { count: chart.fenced })}</p> : null}
      <div className="roll-chart-wrap">
        <GapChart chart={chart} />
      </div>
      <RollsTable market={market} />
      <p className="roll-note muted">{ROLL.idsNote}</p>
    </div>
  )
}
