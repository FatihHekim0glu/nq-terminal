// JRNL: the paper book's journals (TASKS 7.3; UI_SPEC section 7 LIVE and JRNL; look spec 7.11;
// ANALYTICS_CATALOG LV1, LV4). GETs only, polled: /api/live/status for the file list and empty states,
// /api/live/journal for the rows. Rows are newest first and numbered; plumbing rows are hatched and
// carry the exact banner (JournalTable). A journal that is not written yet is never requested: its
// empty state names the expected file.
import { useEffect, useMemo, useState } from 'react'
import { LIVE_POLL_MS, useApiQuery, useLiveStatus } from '../../api/queries'
import { DropdownField, ParamRow } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { JRNL, LIVE } from '../../copy/live'
import { fillCopy } from '../../copy/workspace'
import { actionsItem } from '../oos/panelMenu'
import JournalTable from '../../grids/JournalTable'
import { fileOptions, journalEmptyText, journalQueryEnabled, newestOffset, type LiveStatus } from './liveModel'
import './live.css'

/** The API's largest page; the offset moves to the newest rows once a journal grows past it. */
const PAGE = 5000
const ROW_TYPES = ['warmup', 'skipped', 'delayed_fetch', 'close'] as const
const TYPE_OPTIONS = [{ value: '', label: JRNL.allTypes }, ...ROW_TYPES.map((t) => ({ value: t, label: t }))]

interface RowsProps {
  readonly status: LiveStatus
  readonly file: string
  readonly type: string
  readonly panelId: string
}

function Rows({ status, file, type, panelId }: RowsProps) {
  const [total, setTotal] = useState(0)
  const enabled = journalQueryEnabled(status, file)
  const query = useApiQuery(
    '/api/live/journal',
    { query: { file: file || undefined, type: type || undefined, limit: PAGE, offset: newestOffset(total, PAGE) } },
    { refetchInterval: LIVE_POLL_MS, staleTime: 0, enabled },
  )
  const data = query.data
  const seen = data?.total
  useEffect(() => {
    if (seen !== undefined) setTotal(seen)
  }, [seen])
  const emptyText = journalEmptyText(status, file, type)
  if (!enabled) return <p className="live-message">{emptyText}</p>
  if (query.isError) return <p className="live-message" role="alert">{fillCopy(JRNL.error, { detail: query.error.detail })}</p>
  if (!data) return <p className="live-message">{JRNL.loading}</p>
  return (
    <>
      <p className="live-message">{fillCopy(JRNL.rowsShown, { shown: data.items.length, total: data.total })} {JRNL.plumbingNote}</p>
      <div className="jrnl-body">
        <JournalTable rows={data.items} file={file || JRNL.allFilesName} emptyText={emptyText} panelId={panelId || undefined} scroll="panel" />
      </div>
    </>
  )
}

export default function JrnlScreen(_props: ScreenProps) {
  const actions = usePanelActions()
  const statusQuery = useLiveStatus()
  const status = statusQuery.data
  const [file, setFile] = useState('')
  const [type, setType] = useState('')
  const files = useMemo(() => (status ? fileOptions(status) : [{ value: '', label: JRNL.allFiles }]), [status])
  const plumbing = status?.journals.find((j) => j.name === file)?.plumbing === true
  return (
    <div className="jrnl-screen">
      <FunctionBar
        panelId={actions.panelId}
        title={JRNL.title}
        field={<DropdownField label={JRNL.fileField} value={file} options={files} onChange={setFile} />}
        items={[
          actionsItem(actions),
        ]}
      />
      <ParamRow label={JRNL.paramsLabel}>
        <DropdownField label={JRNL.typeField} value={type} options={TYPE_OPTIONS} onChange={setType} />
        {plumbing ? <span className="jrnl-tag">{LIVE.plumbingTag}</span> : null}
      </ParamRow>
      {statusQuery.isError ? (
        <p className="live-message" role="alert">{fillCopy(JRNL.error, { detail: statusQuery.error.detail })}</p>
      ) : status ? (
        <Rows key={`${file}|${type}`} status={status} file={file} type={type} panelId={actions.panelId} />
      ) : (
        <p className="live-message">{JRNL.loading}</p>
      )}
    </div>
  )
}
