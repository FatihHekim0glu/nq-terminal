// The host of the Start from form on a screen (LEDG, RUN): `useStartFrom()` keeps the seed the form opens from and gives
// the screen an `open(seed)` for its menu and the `panel` to render. Nothing is read until the form is open: the jobs
// list (run ids already taken, whether the runner is on, whether the queue is full), the run index and the presets
// route are read by the panel, which mounts only then. Closing puts the focus back where it was.
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRuns } from '../../api/queries'
import { LAUNCH } from '../../copy/launch'
import { fillCopy } from '../../copy/workspace'
import { queueState, takenRunIds } from '../jobs/model'
import { QUEUE_CAP } from '../jobs/rules'
import type { JobView } from '../jobs/types'
import { useJobsList } from '../jobs/useJobs'
import LaunchForm from './LaunchForm'
import { failureDetail } from './launchClient'
import { seedLabel } from './model'
import type { LaunchSeed } from './types'
import { usePresets } from './useLaunch'

const NO_JOBS: readonly JobView[] = []

function blockedReason(enabled: boolean | undefined, jobs: readonly JobView[], cap: number): string | null {
  if (enabled === false) return LAUNCH.runnerOff
  const state = queueState(jobs, cap)
  return state.full ? fillCopy(LAUNCH.queueFull, { cap }) : null
}

interface PanelProps {
  readonly seed: LaunchSeed
  /** What the last pick from the preset picker did, in words, or null: a live region that outlives the form it replaced. */
  readonly notice: string | null
  readonly onPick: (seed: LaunchSeed) => void
  readonly onClose: () => void
}

function StartFromPanel({ seed, notice, onPick, onClose }: PanelProps) {
  const jobs = useJobsList()
  const runs = useRuns()
  const presets = usePresets()
  const list = jobs.data?.jobs ?? NO_JOBS
  const cap = jobs.data !== undefined && jobs.data.queue_cap > 0 ? jobs.data.queue_cap : QUEUE_CAP
  const taken = useMemo(() => takenRunIds(list, (runs.data ?? []).map((r) => r.run_id)), [list, runs.data])
  const note = presets.isError
    ? fillCopy(LAUNCH.presetsFailed, { detail: failureDetail(presets.error) })
    : presets.isPending
      ? LAUNCH.presetsLoading
      : null
  return (
    <>
      <p className="launch-live" role="status">{notice ?? ''}</p>
      <LaunchForm
        key={seed.sourceRunId + JSON.stringify(seed.params)}
        seed={seed}
        strategies={presets.data?.strategies ?? []}
        presets={presets.data?.presets ?? []}
        presetsNote={note}
        taken={taken}
        blocked={blockedReason(jobs.data?.enabled, list, cap)}
        onPick={onPick}
        fromPicker={notice !== null}
        onClose={onClose}
      />
    </>
  )
}

export interface StartFrom {
  /** Opens the form from this seed (replacing one already open). */
  readonly open: (seed: LaunchSeed) => void
  readonly close: () => void
  readonly isOpen: boolean
  /** The form region, or null while it is closed. Render it where the screen has room for it. */
  readonly panel: ReactNode
}

export function useStartFrom(): StartFrom {
  const [seed, setSeed] = useState<LaunchSeed | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const open = useCallback((next: LaunchSeed) => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) returnTo.current = document.activeElement
    setNotice(null)
    setSeed(next)
  }, [])
  // A pick from the preset picker replaces the form and discards its edits: say so, and keep the focus on the picker (WCAG 3.2.2).
  const pick = useCallback((next: LaunchSeed) => {
    setNotice(fillCopy(LAUNCH.presetPicked, { label: seedLabel(next) }))
    setSeed(next)
  }, [])
  const close = useCallback(() => {
    setNotice(null)
    setSeed(null)
    const back = returnTo.current
    returnTo.current = null
    if (back !== null && back.isConnected) back.focus()
  }, [])
  const panel = seed === null ? null : <StartFromPanel seed={seed} notice={notice} onPick={pick} onClose={close} />
  return { open, close, isOpen: seed !== null, panel }
}
