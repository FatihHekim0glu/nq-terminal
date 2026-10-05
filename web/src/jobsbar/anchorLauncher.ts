// The launcher the anchor panel gives its re-run control: POST /api/jobs/actions with the base run id and nothing else.
// The server derives the configuration from the base run's own result and picks the next free t_<base>_regress_r<N>.
import { postAction } from '../api/jobsClient'
import type { AnchorLauncher } from './anchorRerun.store'

export const SERVER_ANCHOR_LAUNCHER: AnchorLauncher = async (baseRunId) => {
  const result = await postAction({ kind: 'anchor', base_run_id: baseRunId })
  return { id: result.job.id, run_id: result.job.run_id }
}
