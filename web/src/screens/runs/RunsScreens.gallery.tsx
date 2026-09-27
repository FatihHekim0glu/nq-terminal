// Gallery entry /__gallery/RunsScreens (TASKS 6.3): RUNS, or RUN for `?run=<run id>`, in panel chrome at
// the full workspace size, reading the fixture backend (the E2E run's fixture mode).
import GalleryPanel, { galleryParam } from './galleryPanel'
import RunScreen from './RunScreen'
import RunsScreen from './RunsScreen'

export default function RunsScreensGallery() {
  const run = galleryParam('run')
  if (run === '') {
    const params = { code: 'RUNS', context: null, args: {}, group: '-' } as const
    return (
      <GalleryPanel code="RUNS" title="RUNS" group="-">
        <RunsScreen params={params} context={null} />
      </GalleryPanel>
    )
  }
  const context = { kind: 'run', value: run } as const
  return (
    <GalleryPanel code="RUN" title={`${run} RUN`} group="B">
      <RunScreen params={{ code: 'RUN', context, args: {}, group: 'B' }} context={context} />
    </GalleryPanel>
  )
}
