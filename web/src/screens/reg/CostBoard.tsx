// CostBoard (93) Cost survival, look spec 7.2, roadmap #5, EX4): one small SVG tile per registry
// row's recorded cost ladder, each on its own stated scale including 0 (never a shared axis: bar
// heights across tiles are not comparable), with signed rung text and a dashed break-even marker
// when the recorded break-even sits on the drawn ladder. Number <GO> on a tile opens that
// hypothesis's own COST view. Colour comes only from regViews.css's tokens; no element here carries
// a fill, stroke or colour attribute of its own.
import ChartA11y from '../../charts/ChartA11y'
import { requestLine } from '../../chrome/CommandLine.bus'
import { useNumbered } from '../../chrome/PanelChrome.numbers'
import { COST_BOARD, EVIDENCE } from '../../copy/evidence'
import { fillCopy } from '../../copy/workspace'
import type { CostBoardView, CostTile } from './costBoardModel'
import { badgeText } from './regModel'
import './regViews.css'

const W = 200
const H = 56
const BAND_INSET = 0.2

function yOf(value: number, scale: { readonly min: number; readonly max: number }): number {
  const span = scale.max - scale.min
  if (span <= 0) return H
  return H - ((value - scale.min) / span) * H
}

function Bars({ tile }: { readonly tile: CostTile }) {
  const band = W / Math.max(1, tile.rungs.length)
  const zeroY = yOf(0, tile.scale)
  return (
    <>
      <line className="reg-cost-zero" x1={0} x2={W} y1={zeroY} y2={zeroY} />
      {tile.rungs.map((r, i) => {
        if (r.value === null) return null
        const y = yOf(r.value, tile.scale)
        const top = Math.min(y, zeroY)
        const height = Math.max(1, Math.abs(y - zeroY))
        return (
          <rect
            key={r.ticks}
            className={r.value < 0 ? 'reg-cost-neg' : 'reg-cost-pos'}
            x={i * band + band * BAND_INSET}
            y={top}
            width={band * (1 - 2 * BAND_INSET)}
            height={height}
          />
        )
      })}
      {tile.breakEvenAt !== null ? (
        <line className="reg-cost-even" x1={(tile.breakEvenAt + 0.5) * band} x2={(tile.breakEvenAt + 0.5) * band} y1={0} y2={H} />
      ) : null}
    </>
  )
}

function Tile({ tile }: { readonly tile: CostTile }) {
  return (
    <li className="reg-cost-tile">
      <p className="reg-cost-head">
        <span className="reg-cost-n">{`${tile.n})`}</span> <span className="reg-cost-name">{tile.name}</span>{' '}
        <span className="reg-cost-badge">{badgeText(tile.badge)}</span> <span className="reg-cost-be">{tile.breakEvenText}</span>
      </p>
      <svg className="reg-cost-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <Bars tile={tile} />
      </svg>
      <p className="reg-cost-scale">{tile.scaleText}</p>
      <ul className="reg-cost-rungs">
        {tile.rungs.map((r) => (
          <li key={r.ticks}>
            <span className="reg-cost-rung-label">{r.label}</span> <span className="reg-cost-rung-value">{r.text}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}

export interface CostBoardProps {
  readonly panelId: string
  readonly view: CostBoardView
}

function statusText(status: CostBoardView['status']): string {
  if (status === null) return ''
  if (status.kind === 'reading') return fillCopy(EVIDENCE.reading, { n: status.n })
  return fillCopy(COST_BOARD.failed, { n: status.n, name: status.name, detail: status.detail })
}

export default function CostBoard({ panelId, view }: CostBoardProps) {
  useNumbered(
    panelId,
    'reg-cost-tiles',
    view.tiles.map((t) => ({ n: t.n, label: fillCopy(COST_BOARD.tileOpen, { name: t.name }), run: () => requestLine(`${t.name} COST`) })),
  )
  const noLadder = view.missing.filter((m) => m.reason === 'none')
  return (
    <>
      <ChartA11y label={view.label} table={view.table}>
        <ul className="reg-cost-tiles">
          {view.tiles.map((t) => (
            <Tile key={t.name} tile={t} />
          ))}
        </ul>
      </ChartA11y>
      {/* Always mounted (never removed and re-added), empty until anything is pending or failed: a
       *  node that mounts already holding text is often not announced, and a screen reader tracks a
       *  live region by node identity, not by when it first appears (mirrors RegEvidence.StatusLine). */}
      <p className="reg-msg" role="status">{statusText(view.status)}</p>
      {noLadder.length > 0 ? (
        <p className="reg-msg reg-muted">
          {fillCopy(COST_BOARD.missing, { n: noLadder.length, names: noLadder.map((m) => m.name).join(', ') })}
        </p>
      ) : null}
    </>
  )
}
