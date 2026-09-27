// DES for a sealed-window confirmation (UI_SPEC section 6 "Spent window"): the confirmation is [SPENT],
// with its own alpha, verdict, spec hash check and the API's spent label ("spent window, opened
// 2026-09-26, descriptive only"), and a link back to the in-sample hypothesis it tested. Read from
// GET /api/confirmations, which also serves the confirmation spec's own pass bar and hypothesis verbatim;
// the confirmation is not a registry row, so /api/hypotheses is never asked for it.
import { useRef } from 'react'
import { requestLine } from '../../chrome/CommandLine.bus'
import { usePanelPage } from '../../chrome/PanelChrome.page'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { DesBar, DesCard, Pairs, ShaChecks, Tag, VerdictBadge, roving } from './DesParts'
import { MISSING, formatNumber, hypothesisText, passBarText, shortSha, verdictBadge, type Confirmation } from './desModel'

export interface ConfirmationDesProps {
  readonly confirmation: Confirmation
}

const P_DECIMALS = 4
const ALPHA_DECIMALS = 2

export default function ConfirmationDes({ confirmation: c }: ConfirmationDesProps) {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const k = DES.confirmation
  const parent = c.parent
  // The confirmation's own frozen spec, as /api/confirmations serves it (never the parent's).
  const spec = { pass_bar: c.pass_bar, hypothesis: c.hypothesis }
  // A backend started before the merge does not serve the confirmation spec at all.
  const served = 'pass_bar' in c
  const passBar = passBarText(spec)
  const hypothesis = hypothesisText(spec)
  return (
    <div className="des" ref={ref} role="group" aria-label={fillCopy(DES.bodyLabel, { name: c.name })}>
      <DesBar title={DES.confirmationTitle} page={page} current={c.name} />
      <div className="des-head-block">
        <div className="des-head" data-testid="des-head">
          <h3 className="des-name">{c.name}</h3>
          <VerdictBadge badge={verdictBadge(c.verdict)} />
          <Tag tag={DES.spent} />
          <span className="des-spec" title={c.spec_sha256 ?? undefined}>{fillCopy(DES.specLine, { sha: shortSha(c.spec_sha256) })}</span>
          <ShaChecks ok={c.spec_sha_ok} />
        </div>
        <p className="des-spent-label">{c.label}</p>
      </div>
      <div className="des-page">
        <div className="des-cols des-cols-2">
          <DesCard title={DES.confirmationTitle}>
            <Pairs
              rows={[
                [k.parent, parent ? (
                  <button type="button" className="des-link" aria-label={fillCopy(DES.openConfirmation, { name: parent })} onClick={() => requestLine(`${parent} DES`)} {...roving}>
                    {parent}
                  </button>
                ) : MISSING],
                [k.n, c.n === null ? MISSING : String(c.n)],
                [k.p, formatNumber(c.p, P_DECIMALS)],
                [k.alpha, formatNumber(c.alpha, ALPHA_DECIMALS)],
                [k.verdict, c.verdict],
                [k.spec, c.spec],
                [k.sha, <span title={c.spec_sha256 ?? undefined}>{shortSha(c.spec_sha256)}</span>],
                [k.opening, <span className={c.opening_closed ? undefined : 'tone-warn'}>{c.opening_closed ? k.openingClosed : k.openingOpen}</span>],
              ]}
            />
          </DesCard>
          <DesCard title={DES.passBar}>
            {passBar ? (
              <pre className="des-prose des-prose-full" data-testid="des-confirm-pass-bar">{passBar}</pre>
            ) : (
              <p className="des-note">{served ? DES.passBarNone : k.passBarGap}</p>
            )}
          </DesCard>
          {hypothesis ? (
            <DesCard title={DES.hypothesis}>
              <pre className="des-prose des-prose-full" data-testid="des-confirm-hypothesis">{hypothesis}</pre>
            </DesCard>
          ) : null}
        </div>
      </div>
    </div>
  )
}
