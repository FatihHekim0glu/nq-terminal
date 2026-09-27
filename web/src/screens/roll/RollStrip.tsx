// The calendar strip (TASKS Phase 11): every market as a numbered row, the twelve months across. For one
// year a cell holds the gap in percent of that month's roll (signed, so colour is never the only cue), or
// `2x` when a month holds two; for all years it counts the rolls in that calendar month, which shows each
// market's roll cycle. Each cell carries a full sentence for assistive technology. The row's ticker is a
// button (and Number <GO> on the row number) that opens the market's rolls.
import { useMemo } from 'react'
import { useNumbered, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { CONTRACT_NAMES } from '../../copy/market'
import { ROLL } from '../../copy/roll'
import { fillCopy } from '../../copy/workspace'
import { cellLabel, cellText, type StripRow, type YearChoice } from './model'

const roving = { [ROVING_ATTR]: '' }

function cellClass(row: StripRow, month: number, year: YearChoice): string {
  const cell = row.cells[month]!
  if (cell.count === 0) return 'roll-cell num'
  if (year === 'all' || cell.count > 1 || cell.gapPct === null) return 'roll-cell roll-on num'
  return `roll-cell roll-on num ${cell.gapPct >= 0 ? 'up' : 'down'}`
}

export interface RollStripProps {
  readonly panelId: string
  readonly rows: readonly StripRow[]
  readonly year: YearChoice
  readonly onOpen: (symbol: string) => void
}

export default function RollStrip({ panelId, rows, year, onOpen }: RollStripProps) {
  const numbered = useMemo<NumberedItem[]>(
    () => rows.map((r) => ({ n: r.n, label: fillCopy(ROLL.numberedMarket, { root: r.root }), run: () => onOpen(r.symbol) })),
    [rows, onOpen],
  )
  useNumbered(panelId, 'roll-strip', numbered)
  const C = ROLL.stripCols
  const scope = year === 'all' ? ROLL.allYears : year
  const caption = fillCopy(ROLL.stripCaption, { year: scope, cells: year === 'all' ? ROLL.stripCaptionAll : ROLL.stripCaptionYear })
  return (
    <div className="nqt-grid-scroll roll-strip-wrap">
      <table className="nqt-grid roll-strip" data-testid="roll-strip">
        <caption className="roll-note">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">{C.n}</th>
            <th scope="col">{C.ticker}</th>
            <th scope="col">{C.name}</th>
            {ROLL.monthNames.map((m) => <th key={m} scope="col" className="num">{m}</th>)}
            <th scope="col" className="num">{C.rolls}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.symbol}>
              <td className="num muted">{`${row.n})`}</td>
              <th scope="row" className="name">
                <button type="button" className="roll-pick" aria-label={fillCopy(ROLL.stripOpen, { root: row.root })} onClick={() => onOpen(row.symbol)} {...roving}>
                  {row.root}
                </button>
              </th>
              <td className="roll-name">{CONTRACT_NAMES[row.root] ?? row.root}</td>
              {row.cells.map((cell, month) => (
                <td key={month} className={cellClass(row, month, year)}>
                  <span className="sr-only">{cellLabel(row, month, year)}</span>
                  <span aria-hidden="true">{cellText(cell, year)}</span>
                </td>
              ))}
              <td className="num">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
