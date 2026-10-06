// React side of the chart contrast modes (theme/chartContrast.ts): charts re-read their tokens and
// redraw when forced colours, prefers-contrast or the colour scheme changes while they are mounted.
import { useEffect, useMemo, useState } from 'react'
import { readLiveChartTokens, subscribeChartContrast, type ChartTokens, type KeywordReader, type MediaMatcher } from './theme'

/**
 * A counter that goes up on every contrast media change: a dependency for chart build effects, so a
 * change rebuilds the chart with freshly read tokens. `match` is for tests; the page uses matchMedia.
 */
export function useChartContrastVersion(match?: MediaMatcher | null, read?: KeywordReader): number {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeChartContrast(() => setVersion((v) => v + 1), match, read), [match, read])
  return version
}

/** The chart tokens as the page resolves them now (contrast modes and CVD themes included), re-read on a contrast change. */
export function useLiveChartTokens(): ChartTokens {
  const version = useChartContrastVersion()
  return useMemo(() => {
    void version
    return readLiveChartTokens()
  }, [version])
}
