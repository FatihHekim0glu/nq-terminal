// Gallery entry /__gallery/Distribution (TASKS 5.3): RET histogram beside the daily returns, from seeded fixture data.
import { useMemo } from 'react'
import { ECHARTS_GALLERY as G } from '../../copy/echarts'
import { Distribution } from './Distribution'
import { distributionFixture } from './galleryFixtures'
import { GalleryPanel, GalleryPanels } from './GalleryPanels'

export default function DistributionGallery() {
  const data = useMemo(distributionFixture, [])
  return (
    <GalleryPanels>
      <GalleryPanel title={G.titles.distribution}>
        <Distribution data={data} chartId="distribution" />
      </GalleryPanel>
    </GalleryPanels>
  )
}
