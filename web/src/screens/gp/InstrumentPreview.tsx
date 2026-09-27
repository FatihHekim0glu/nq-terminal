// The instrument DES price card (look spec 7.3 and 4.3): the two-line quote header in the panel's quote
// slot and a one-year daily candle chart to the fence, from the same GET /api/bars read as GP (vendor
// series, through the gate). A window past the fence is never asked for; a refusal or error shows the
// gate's text in the card, as on GP.
import { useMemo } from 'react'
import CandleChart from '../../charts/CandleChart'
import QuoteHeader from '../../chrome/QuoteHeader'
import { displayInstrument } from '../../commands/sectors'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import '../../charts/theme/chart.css'
import { GP_COPY as C } from './copy'
import { ChartMessage } from './GpStatus'
import { ET_ZONE, rangeWindow, symbolFor } from './model'
import { useChartView } from './useChartView'
import { useGpData } from './useGpData'
import './GpScreen.css'

export interface InstrumentPreviewProps {
  readonly root: string
  readonly link?: PanelLink
}

/** The range the preview shows: one year of daily bars ending at the fence. */
export const PREVIEW_RANGE = '1Y'

export default function InstrumentPreview({ root, link = '-' }: InstrumentPreviewProps) {
  const symbol = symbolFor(root)
  const ticker = displayInstrument(root, null)
  const window = useMemo(() => rangeWindow(PREVIEW_RANGE), [])
  const data = useGpData({ root, symbol, tf: '1d', variant: 'vendor', window, runId: null })
  const view = useChartView(data, root, ticker, '1d', true)
  const bars = data.bars
  const show = bars !== undefined && bars.t.length > 0 && data.refusal === null
  const text = data.barsLoading ? C.loading : fillCopy(C.empty, { ticker, tf: '1d', variant: data.variant })
  return (
    <>
      {symbol ? <QuoteHeader quote={view.quote} /> : null}
      <div className="gp-mini">
        {show ? (
          <CandleChart name={ticker} bars={bars} rolls={view.rolls} link={link} timeZone={ET_ZONE} precision={view.precision} minMove={10 ** -view.precision} />
        ) : (
          <ChartMessage refusal={data.refusal} error={data.barsError} text={symbol ? text : fillCopy(C.badSymbol, { value: root })} />
        )}
      </div>
    </>
  )
}
