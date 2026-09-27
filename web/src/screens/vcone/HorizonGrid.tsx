// VCONE's horizon grid: one row per horizon with the cone's statistics as served (% to 1 decimal, the rank to 0
// decimals). Each row is numbered 1) to 6) (Number <GO>) and its first cell is a button, a roving item of the
// panel, that opens the 27 futures at that horizon; the selected horizon's row is marked.
import { useNumbered } from '../../chrome/PanelChrome.numbers'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { VCONE } from '../../copy/vcone'
import { fillCopy } from '../../copy/workspace'
import '../../grids/grid.css'
import { statCells } from './model'
import type { VolConeRow } from './types'

const roving = { [ROVING_ATTR]: '' }
const STAT_HEADERS = [
  ['min', VCONE.colMin],
  ['p10', VCONE.colP10],
  ['p25', VCONE.colP25],
  ['p50', VCONE.colP50],
  ['p75', VCONE.colP75],
  ['p90', VCONE.colP90],
  ['max', VCONE.colMax],
  ['latest', VCONE.colLatest],
  ['rank', VCONE.colRank],
] as const

export interface HorizonGridProps {
  readonly panelId: string
  readonly ticker: string
  readonly rows: readonly VolConeRow[]
  readonly selected: number
  readonly onOpen: (sessions: number) => void
}

export default function HorizonGrid({ panelId, ticker, rows, selected, onOpen }: HorizonGridProps) {
  useNumbered(panelId, 'vcone-rows', rows.map((r, i) => ({ n: i + 1, label: fillCopy(VCONE.rowOpen, { n: r.sessions }), run: () => onOpen(r.sessions) })))
  return (
    <table className="nqt-grid vcone-grid" aria-label={fillCopy(VCONE.gridLabel, { ticker })}>
      <thead>
        <tr>
          <th scope="col">{VCONE.colHorizon}</th>
          <th scope="col" className="num">{VCONE.colWindows}</th>
          <th scope="col">{VCONE.colFirst}</th>
          {STAT_HEADERS.map(([key, label]) => (
            <th key={key} scope="col" className="num">{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const cells = statCells(r)
          return (
            <tr key={r.sessions} className={r.sessions === selected ? 'vcone-row-on' : undefined}>
              <th scope="row">
                <button
                  type="button"
                  className="vcone-row-btn"
                  aria-label={`${i + 1}) ${fillCopy(VCONE.horizonCell, { n: r.sessions })}: ${fillCopy(VCONE.rowOpen, { n: r.sessions })}`}
                  onClick={() => onOpen(r.sessions)}
                  {...roving}
                >
                  <span className="vcone-n">{`${i + 1})`}</span> {fillCopy(VCONE.horizonCell, { n: r.sessions })}
                </button>
              </th>
              <td className="num">{r.n}</td>
              <td className="vcone-date">{r.first_date ?? '--'}</td>
              {STAT_HEADERS.map(([key]) => (
                <td key={key} className={key === 'latest' ? 'vcone-latest-cell num' : 'num'}>{cells[key]}</td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
