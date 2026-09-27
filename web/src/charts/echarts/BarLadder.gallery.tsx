// Gallery entry /__gallery/BarLadder (TASKS 5.3): the three ladder uses side by side, blocks with
// confidence whiskers, P&L by weekday with whiskers, and the cost ladder with its break-even marker.
import { useMemo } from 'react'
import { ECHARTS_GALLERY as G } from '../../copy/echarts'
import { BarLadder } from './BarLadder'
import { GalleryPanel, GalleryPanels } from './GalleryPanels'
import { blocksFixture, costFixture, weekdayFixture } from './galleryFixtures'

export default function BarLadderGallery() {
  const blocks = useMemo(blocksFixture, [])
  const weekday = useMemo(weekdayFixture, [])
  const cost = useMemo(costFixture, [])
  return (
    <GalleryPanels>
      <GalleryPanel title={G.titles.blocks}>
        <BarLadder data={blocks} chartId="blocks" />
      </GalleryPanel>
      <GalleryPanel title={G.titles.weekday}>
        <BarLadder data={weekday} chartId="weekday" />
      </GalleryPanel>
      <GalleryPanel title={G.titles.cost}>
        <BarLadder data={cost} chartId="cost" />
      </GalleryPanel>
    </GalleryPanels>
  )
}
