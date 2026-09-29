// DES robustness view (roadmap #4, slice 2 of 3; ANALYTICS_CATALOG C7): every robustness section a
// screen file records (spec curve, placebo, stability, quintiles, tails, subsets, other recorded
// sections), drawn read only from readRobustness (screens/des/robustnessModel.ts): no value here is
// recomputed, and every section names its own tag, basis and unit. The forks card below it lets the
// user compare the same hypothesis at another recorded cost (Basis A, a screen fork) or against a
// linked Nautilus run's own account series (Basis B, a run fork); the two bases never share a ladder
// (forkModel.ts). ScreenEvidence and ForkCurveView are pure; only the default export fetches, and only
// once mounted.
import { useMemo } from 'react'
import type { ApiError } from '../../api/client'
import { useRuns } from '../../api/queries'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { requestLine } from '../../chrome/CommandLine.bus'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { DES, DES_ROBUSTNESS } from '../../copy/des'
import { SPEC } from '../../copy/tiles'
import { fillCopy } from '../../copy/workspace'
import {
  MAX_FORK_RUNS,
  forkLadders,
  forkRows,
  forkSpecs,
  type ForkPoint,
  type ForkRow,
  type ForkSkip,
} from './forkModel'
import { formatNumber, MISSING, ticksLabel, type HypothesisCard, type HypothesisDetail } from './desModel'
import { DesCard, LoadError, Pairs, Status, Tag } from './DesParts'
import {
  negativeCount,
  placeboLadder,
  readRobustness,
  specCurveLadder,
  yearLadder,
  type QuintileRow,
  type ScreenJson,
  type SubsetRow,
  type TailRow,
  type VariantRow,
  type YearRow,
} from './robustnessModel'
import { useForkPoints } from './useForks'
import './des.css'

const DECIMALS = 2

function num(value: number | null, decimals = DECIMALS, signed = false): string {
  return formatNumber(value, decimals, signed)
}

function VariantTable({ rows }: { readonly rows: readonly VariantRow[] }) {
  const c = DES_ROBUSTNESS.cols
  if (rows.length === 0) return null
  return (
    <table className="nqt-grid des-table des-robustness-variants">
      <caption className="des-caption">{DES_ROBUSTNESS.specTitle}</caption>
      <thead>
        <tr>
          <th scope="col" className="num">{c.no}</th>
          <th scope="col">{c.variant}</th>
          <th scope="col" className="num">{c.sharpeM}</th>
          <th scope="col" className="num">{c.sharpeBh}</th>
          <th scope="col" className="num">{c.dsr1}</th>
          <th scope="col" className="num">{c.dsr2}</th>
          <th scope="col" className="num">{c.alpha}</th>
          <th scope="col" className="num">{c.tMin}</th>
          <th scope="col" className="num">{c.turnover}</th>
          <th scope="col" className="num">{c.tradeDays}</th>
          <th scope="col" className="num">{c.sessions}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="num muted">{r.key === 'headline' ? DES_ROBUSTNESS.headlineShort : r.no}</td>
            <th scope="row">{r.key === 'headline' ? DES_ROBUSTNESS.headline : r.key}</th>
            <td className="num">{num(r.sharpeM, 4, true)}</td>
            <td className="num">{num(r.sharpeBh, 4, true)}</td>
            <td className="num">{num(r.dsr1, 4, true)}</td>
            <td className="num">{num(r.dsr2, 4, true)}</td>
            <td className="num">{num(r.alphaPct1, 2, true)}</td>
            <td className="num">{num(r.tMin1, 2, true)}</td>
            <td className="num">{r.turnover === null ? MISSING : num(r.turnover, 2)}</td>
            <td className="num">{r.tradeDays ?? MISSING}</td>
            <td className="num">{r.nEval ?? MISSING}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function YearTable({ rows, caption }: { readonly rows: readonly YearRow[]; readonly caption: string }) {
  const c = DES_ROBUSTNESS.cols
  if (rows.length === 0) return null
  return (
    <table className="nqt-grid des-table des-robustness-years">
      <caption className="des-caption">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{c.year}</th>
          <th scope="col" className="num">{c.alpha}</th>
          <th scope="col" className="num">{c.tMin}</th>
          <th scope="col" className="num">{c.n}</th>
          <th scope="col" className="num">{c.b}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.year}>
            <th scope="row">{r.year}</th>
            <td className="num">{num(r.alphaPct, 2, true)}</td>
            <td className="num">{num(r.tMin, 2, true)}</td>
            <td className="num">{r.n ?? MISSING}</td>
            <td className="num">{num(r.b, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function QuintileTable({ rows }: { readonly rows: readonly QuintileRow[] }) {
  const c = DES_ROBUSTNESS.cols
  if (rows.length === 0) return null
  return (
    <table className="nqt-grid des-table des-robustness-quintiles">
      <caption className="des-caption">{DES_ROBUSTNESS.quintilesTitle}</caption>
      <thead>
        <tr>
          <th scope="col" className="num">{c.quintile}</th>
          <th scope="col" className="num">{c.n}</th>
          <th scope="col" className="num">{c.sigma2}</th>
          <th scope="col" className="num">{c.meanPct}</th>
          <th scope="col" className="num">{c.sdPct}</th>
          <th scope="col" className="num">{c.meanOverVar}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          // eslint-disable-next-line react/no-array-index-key -- a quintile row has no stable id of its own
          <tr key={i}>
            <th scope="row" className="num">{r.quintile ?? MISSING}</th>
            <td className="num">{r.n ?? MISSING}</td>
            <td className="num">{num(r.sigma2Median, 6)}</td>
            <td className="num">{num(r.meanPct, 3, true)}</td>
            <td className="num">{num(r.sdPct, 3)}</td>
            <td className="num">{num(r.meanOverVar, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TailsTable({ rows }: { readonly rows: readonly TailRow[] }) {
  const c = DES_ROBUSTNESS.cols
  if (rows.length === 0) return null
  return (
    <table className="nqt-grid des-table des-robustness-tails">
      <caption className="des-caption">{DES_ROBUSTNESS.tailsTitle}</caption>
      <thead>
        <tr>
          <th scope="col">{c.measure}</th>
          <th scope="col" className="num">{DES_ROBUSTNESS.managed}</th>
          <th scope="col" className="num">{DES_ROBUSTNESS.bh}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.measure}>
            <th scope="row">{r.measure}</th>
            <td className="num">{num(r.managed, 3, true)}</td>
            <td className="num">{num(r.bh, 3, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Never a p column (C7): SubsetRow itself carries no p field, only n, mean, median, sd, t, hit rate, total. */
function SubsetTable({ rows }: { readonly rows: readonly SubsetRow[] }) {
  const c = DES_ROBUSTNESS.cols
  if (rows.length === 0) return null
  return (
    <table className="nqt-grid des-table des-robustness-subsets">
      <caption className="des-caption">{DES_ROBUSTNESS.subsetsTitle}</caption>
      <thead>
        <tr>
          <th scope="col">{c.subset}</th>
          <th scope="col" className="num">{c.n}</th>
          <th scope="col" className="num">{c.mean}</th>
          <th scope="col" className="num">{c.median}</th>
          <th scope="col" className="num">{c.sd}</th>
          <th scope="col" className="num">{c.t}</th>
          <th scope="col" className="num">{c.hitRate}</th>
          <th scope="col" className="num">{c.total}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.key}</th>
            <td className="num">{r.n ?? MISSING}</td>
            <td className="num">{num(r.mean, 3, true)}</td>
            <td className="num">{num(r.median, 3, true)}</td>
            <td className="num">{num(r.sd, 3)}</td>
            <td className="num">{num(r.t, 2, true)}</td>
            <td className="num">{r.hitRate === null ? MISSING : num(r.hitRate, 3)}</td>
            <td className="num">{num(r.total, 2, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface ScreenEvidenceProps {
  readonly screen: ScreenJson | null | undefined
  readonly card: HypothesisCard
}

/** Pure: every robustness section the screen file records, read once, nothing recomputed (C7). */
export function ScreenEvidence({ screen, card }: ScreenEvidenceProps) {
  const robustness = useMemo(() => readRobustness(screen), [screen])
  const tag = card.registered ? DES.preReg : DES.postHoc
  const tagText = fillCopy(DES.tag, { tag })
  const c = DES_ROBUSTNESS.cols

  const specRows = robustness.specCurve
    ? [...(robustness.specCurve.headline ? [robustness.specCurve.headline] : []), ...robustness.specCurve.variants]
    : []
  const dsrLadder = robustness.specCurve ? specCurveLadder(robustness.specCurve, 'dsr1', card.name) : null
  const alphaLadder = robustness.specCurve ? specCurveLadder(robustness.specCurve, 'alphaPct1', card.name) : null
  const negatives = negativeCount(robustness.specCurve, 'dsr1')
  const placeboLadderData = robustness.placebo ? placeboLadder(robustness.placebo, card.name) : null
  const loyoLadder = robustness.stability ? yearLadder(robustness.stability.loyo, fillCopy(DES_ROBUSTNESS.loyoName, { name: card.name })) : null
  const perYearLadder = robustness.stability ? yearLadder(robustness.stability.perYear, fillCopy(DES_ROBUSTNESS.perYearName, { name: card.name })) : null

  const nothing = robustness.specCurve === null && robustness.placebo === null && robustness.stability === null
    && robustness.quintiles === null && robustness.tails === null && robustness.subsets === null
    && robustness.generic.length === 0

  if (nothing) return <p className="des-note">{DES_ROBUSTNESS.none}</p>

  return (
    <div className="des-robustness-sections">
      {robustness.specCurve && dsrLadder && alphaLadder ? (
        <DesCard title={DES_ROBUSTNESS.specTitle} testId="des-robustness-spec">
          <p className="des-note"><Tag tag={tag} /> {fillCopy(DES_ROBUSTNESS.basisLine, { unit: dsrLadder.unit || c.sharpe, tag: tagText })}</p>
          <div className="des-ladder"><BarLadder data={dsrLadder} chartId="des-spec-dsr" /></div>
          <p className="des-note">{fillCopy(DES_ROBUSTNESS.basisLine, { unit: alphaLadder.unit || c.sharpe, tag: tagText })}</p>
          <div className="des-ladder"><BarLadder data={alphaLadder} chartId="des-spec-alpha" /></div>
          <p className="des-note" data-testid="des-robustness-negative-line">
            {fillCopy(DES_ROBUSTNESS.negativeLine, { negative: negatives.negative, of: negatives.of, tag: SPEC.postHoc })}
          </p>
          <VariantTable rows={specRows} />
        </DesCard>
      ) : null}
      {robustness.placebo && placeboLadderData ? (
        <DesCard title={DES_ROBUSTNESS.placeboTitle} testId="des-robustness-placebo">
          <p className="des-note"><Tag tag={tag} /> {fillCopy(DES_ROBUSTNESS.basisLine, { unit: placeboLadderData.unit || c.sharpe, tag: tagText })}</p>
          <div className="des-ladder"><BarLadder data={placeboLadderData} chartId="des-placebo" /></div>
          <p className="des-note">
            {fillCopy(DES_ROBUSTNESS.placeboLine, {
              actual: num(robustness.placebo.actual, 2, true),
              percentile: robustness.placebo.percentile ?? MISSING,
              draws: robustness.placebo.draws ?? MISSING,
              seed: robustness.placebo.seed ?? MISSING,
              minShift: robustness.placebo.minShift ?? MISSING,
            })}
          </p>
        </DesCard>
      ) : null}
      {robustness.stability ? (
        <DesCard title={DES_ROBUSTNESS.stabilityTitle} testId="des-robustness-stability">
          <p className="des-note"><Tag tag={tag} /> {fillCopy(DES_ROBUSTNESS.basisLine, { unit: DES_ROBUSTNESS.unitsByColumn, tag: tagText })}</p>
          {loyoLadder && robustness.stability.loyo.length > 0 ? <div className="des-ladder"><BarLadder data={loyoLadder} chartId="des-loyo" /></div> : null}
          <YearTable rows={robustness.stability.loyo} caption={loyoLadder?.name ?? DES_ROBUSTNESS.stabilityTitle} />
          {perYearLadder && robustness.stability.perYear.length > 0 ? <div className="des-ladder"><BarLadder data={perYearLadder} chartId="des-per-year" /></div> : null}
          <YearTable rows={robustness.stability.perYear} caption={perYearLadder?.name ?? DES_ROBUSTNESS.stabilityTitle} />
          {robustness.stability.loyo.length === 0 && robustness.stability.perYear.length === 0 ? <p className="des-note">{DES_ROBUSTNESS.allYears}</p> : null}
        </DesCard>
      ) : null}
      {robustness.quintiles ? (
        <DesCard title={DES_ROBUSTNESS.quintilesTitle} testId="des-robustness-quintiles">
          <p className="des-note"><Tag tag={tag} /> {fillCopy(DES_ROBUSTNESS.basisLine, { unit: DES_ROBUSTNESS.unitsByColumn, tag: tagText })}</p>
          <QuintileTable rows={robustness.quintiles} />
        </DesCard>
      ) : null}
      {robustness.tails ? (
        <DesCard title={DES_ROBUSTNESS.tailsTitle} testId="des-robustness-tails">
          <p className="des-note"><Tag tag={tag} /> {fillCopy(DES_ROBUSTNESS.basisLine, { unit: DES_ROBUSTNESS.unitsByMeasure, tag: tagText })}</p>
          <TailsTable rows={robustness.tails} />
        </DesCard>
      ) : null}
      {robustness.subsets ? (
        <DesCard title={DES_ROBUSTNESS.subsetsTitle} testId="des-robustness-subsets">
          <p className="des-note"><Tag tag={tag} /> {fillCopy(DES_ROBUSTNESS.basisLine, { unit: DES_ROBUSTNESS.unitsRecorded, tag: tagText })}</p>
          <p className="des-note">{DES_ROBUSTNESS.pOmitted}</p>
          <SubsetTable rows={robustness.subsets} />
        </DesCard>
      ) : null}
      {robustness.generic.length > 0 ? (
        <DesCard title={DES_ROBUSTNESS.otherTitle} testId="des-robustness-other">
          <p className="des-note"><Tag tag={tag} /> {fillCopy(DES_ROBUSTNESS.basisLine, { unit: DES_ROBUSTNESS.unitsRecorded, tag: tagText })}</p>
          {robustness.generic.map((section) => (
            <div key={section.key} className="des-robustness-generic-section">
              <h4 className="des-robustness-generic-title">{section.key}</h4>
              <Pairs rows={section.rows} />
              {section.more > 0 ? <p className="des-note">{fillCopy(DES_ROBUSTNESS.more, { n: section.more })}</p> : null}
            </div>
          ))}
        </DesCard>
      ) : null}
    </div>
  )
}

function ForkTable({ rows }: { readonly rows: readonly ForkRow[] }) {
  const c = DES_ROBUSTNESS.cols
  if (rows.length === 0) return null
  return (
    <table className="nqt-grid des-table des-robustness-forks">
      <caption className="des-caption">{DES_ROBUSTNESS.forksTitle}</caption>
      <thead>
        <tr>
          <th scope="col" className="num">{c.no}</th>
          <th scope="col">{c.engine}</th>
          <th scope="col">{c.basis}</th>
          <th scope="col" className="num">{c.cost}</th>
          <th scope="col">{c.freq}</th>
          <th scope="col">{c.run}</th>
          <th scope="col">{c.flags}</th>
          <th scope="col" className="num">{c.n}</th>
          <th scope="col" className="num">{c.sharpe}</th>
          <th scope="col" className="num">{c.interval}</th>
          <th scope="col">{c.tag}</th>
          <th scope="col">{c.state}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.no}>
            <th scope="row" className="num muted">{r.no}</th>
            <td>{r.engine}</td>
            <td>{r.basis}</td>
            <td className="num">{r.cost === null ? MISSING : ticksLabel(r.cost)}</td>
            <td>{r.freq ?? MISSING}</td>
            <td>{r.run ?? MISSING}</td>
            <td>{r.flags || MISSING}</td>
            <td className="num">{r.n ?? MISSING}</td>
            <td className="num">{num(r.sharpe, 3, true)}</td>
            <td className="num">{r.lo === null || r.hi === null ? MISSING : `${num(r.lo, 3, true)} .. ${num(r.hi, 3, true)}`}</td>
            <td>{r.tag ?? MISSING}</td>
            <td>{r.state === null ? MISSING : fillCopy(DES_ROBUSTNESS.notAvailable, { detail: r.state })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function skipLines(skipped: readonly ForkSkip[]): readonly string[] {
  const lines: string[] = []
  for (const s of skipped) {
    if (s.reason === 'unusable') lines.push(fillCopy(DES_ROBUSTNESS.unusable, { run: s.run }))
    if (s.reason === 'unlisted') lines.push(fillCopy(DES_ROBUSTNESS.unlisted, { run: s.run }))
  }
  const cappedCount = skipped.filter((s) => s.reason === 'capped').length
  if (cappedCount > 0) lines.push(fillCopy(DES_ROBUSTNESS.capped, { n: cappedCount, max: MAX_FORK_RUNS }))
  return lines
}

const NO_RUNS_REQUEST = { pending: false, error: null } as const

export interface ForkCurveViewProps {
  readonly points: readonly ForkPoint[]
  readonly skipped: readonly ForkSkip[]
  /** The hypothesis name: a screen fork's EQ line opens on it; a run fork's opens on its run id. */
  readonly name: string
  readonly panelId: string
  /** GET /api/runs's own state, so an empty Basis B ladder can say why (still loading or failed)
   *  instead of always reading "No usable linked run." Defaults to neither, for the gallery and
   *  every other caller that already has its points. */
  readonly runs?: { readonly pending: boolean; readonly error: ApiError | null }
}

/** Pure: the fork ladders, table and skipped lines for fetched ForkPoints; registers their Number <GO>. */
export function ForkCurveView({ points, skipped, name, panelId, runs = NO_RUNS_REQUEST }: ForkCurveViewProps) {
  const rows = useMemo(() => forkRows(points), [points])
  const ladders = useMemo(
    () => forkLadders(points, {
      screen: fillCopy(DES_ROBUSTNESS.forksA, { name }),
      runs: fillCopy(DES_ROBUSTNESS.forksB, { name }),
    }),
    [points, name],
  )
  const numbered = useMemo<NumberedItem[]>(
    () => rows.map((row) => ({
      n: row.no,
      label: fillCopy(DES_ROBUSTNESS.forkOpen, { n: row.no }),
      run: () => requestLine(row.engine === 'screen' ? `${name} EQ` : `${row.run} EQ`),
    })),
    [rows, name],
  )
  useNumbered(panelId, 'des-forks', numbered)
  const lines = skipLines(skipped)

  return (
    <DesCard title={DES_ROBUSTNESS.forksTitle} testId="des-robustness-forks">
      <p className="des-note"><Tag tag={DES.postHoc} /> {DES_ROBUSTNESS.forksNote}</p>
      {ladders.screen ? <div className="des-ladder"><BarLadder data={ladders.screen} chartId="des-forks-a" /></div> : <p className="des-note">{DES_ROBUSTNESS.forksNoneA}</p>}
      {ladders.runs ? (
        <div className="des-ladder"><BarLadder data={ladders.runs} chartId="des-forks-b" /></div>
      ) : runs.error ? (
        <LoadError name={DES_ROBUSTNESS.runsList} error={runs.error} />
      ) : runs.pending ? (
        <Status>{fillCopy(DES.loading, { name: DES_ROBUSTNESS.runsList })}</Status>
      ) : (
        <p className="des-note">{DES_ROBUSTNESS.forksNoneB}</p>
      )}
      <ForkTable rows={rows} />
      {lines.length > 0 ? (
        <ul className="des-robustness-skipped">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
    </DesCard>
  )
}

export interface DesRobustnessProps {
  readonly detail: HypothesisDetail
}

/** The default container: fetches /api/runs and each fork's analytics only once mounted. */
export default function DesRobustness({ detail }: DesRobustnessProps) {
  const runsQuery = useRuns()
  const panelId = usePanelActions().panelId
  const { specs, skipped } = useMemo(() => forkSpecs(detail.card, runsQuery.data), [detail.card, runsQuery.data])
  const points = useForkPoints(specs)

  return (
    <div className="des-page des-robustness">
      <p className="des-note">{DES_ROBUSTNESS.header}</p>
      <ScreenEvidence screen={detail.screen} card={detail.card} />
      <ForkCurveView
        points={points}
        skipped={skipped}
        name={detail.card.name}
        panelId={panelId}
        runs={detail.card.nautilus_runs.length === 0 ? undefined : { pending: runsQuery.isPending, error: runsQuery.error ?? null }}
      />
    </div>
  )
}
