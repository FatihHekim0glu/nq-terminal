// Gallery entry /__gallery/MtReplication (MT 86) Replication, roadmap R8): the replication view over the
// served fixtures (regFixtures.ts: the family, the registry and the one sealed confirmation), backend free,
// in the real panel chrome so the chart, the pairs grid and the untested line are checked before the merge.
import GalleryPanel from '../runs/galleryPanel'
import { MULTIPLE_TESTING, REGISTRY } from './regFixtures'
import { ReplicationBody } from './MtReplication'
import { buildReplication } from './replicationModel'

const VIEW = buildReplication(MULTIPLE_TESTING, REGISTRY)

export default function MtReplicationGallery() {
  return (
    <GalleryPanel code="MT" title="MT 86) Replication" group="-">
      <ReplicationBody view={VIEW} registryError={null} />
    </GalleryPanel>
  )
}
