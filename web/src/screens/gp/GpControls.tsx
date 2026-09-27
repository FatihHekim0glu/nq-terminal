// GP and GIP controls (look spec 4.5, 6.4, 7.6): the parameter row of amber fields (the range or the
// date, the variant, the run whose fills are drawn) and the range row of contiguous toggle buttons
// (ranges on GP, bar sizes, rolls). Every control is a roving item of the panel.
import { useId } from 'react'
import { AmberField, DropdownField, ParamRow } from '../../chrome/Field'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { fillCopy } from '../../copy/workspace'
import { GP_COPY as C } from './copy'
import { SPAN_CAP_YEARS, type GpTimeframe, type RangeCode, type Variant } from './model'

const roving = { [ROVING_ATTR]: '' }

export interface ParamsProps {
  readonly mode: 'GP' | 'GIP'
  readonly draftStart: string
  readonly draftEnd: string
  readonly onDraftStart: (value: string) => void
  readonly onDraftEnd: (value: string) => void
  readonly onSubmit: () => void
  readonly variant: Variant
  readonly variants: readonly Variant[]
  readonly onVariant: (value: Variant) => void
  readonly runs: readonly string[]
  readonly run: string | null
  readonly onRun: (value: string | null) => void
}

const DATE_WIDTH = '96px'

export function GpParams(p: ParamsProps) {
  const runOptions = [{ value: '', label: C.fillsNone }, ...p.runs.map((r) => ({ value: r, label: r }))]
  return (
    <ParamRow label={C.paramsLabel}>
      {p.mode === 'GP' ? (
        <>
          <AmberField label={C.rangeStartName} value={p.draftStart} onChange={p.onDraftStart} onSubmit={p.onSubmit} width={DATE_WIDTH} placeholder={C.datePlaceholder} />
          <span className="gp-sep" aria-hidden="true">-</span>
          <AmberField label={C.rangeEndName} value={p.draftEnd} onChange={p.onDraftEnd} onSubmit={p.onSubmit} width={DATE_WIDTH} placeholder={C.datePlaceholder} />
        </>
      ) : (
        <AmberField label={C.dateName} value={p.draftStart} onChange={p.onDraftStart} onSubmit={p.onSubmit} width={DATE_WIDTH} placeholder={C.datePlaceholder} />
      )}
      <DropdownField
        label={C.variant}
        value={p.variant}
        options={p.variants.map((v) => ({ value: v, label: v }))}
        onChange={(v) => p.onVariant(v as Variant)}
      />
      <DropdownField label={C.fills} value={p.run ?? ''} options={runOptions} onChange={(v) => p.onRun(v === '' ? null : v)} />
    </ParamRow>
  )
}

interface ToggleProps {
  readonly label: string
  readonly pressed: boolean
  readonly onPress: () => void
  readonly disabledReason?: string | null
}

function Toggle({ label, pressed, onPress, disabledReason }: ToggleProps) {
  const reasonId = useId()
  const disabled = Boolean(disabledReason)
  return (
    <>
      <button
        type="button"
        className="chart-range-btn gp-btn"
        aria-pressed={pressed}
        aria-disabled={disabled ? true : undefined}
        aria-describedby={disabled ? reasonId : undefined}
        onClick={() => {
          if (!disabled) onPress()
        }}
        {...roving}
      >
        {label}
      </button>
      {disabled ? <span id={reasonId} className="sr-only">{disabledReason}</span> : null}
    </>
  )
}

export interface RangeRowProps {
  readonly mode: 'GP' | 'GIP'
  readonly timeframes: readonly GpTimeframe[]
  readonly tf: GpTimeframe
  readonly onTf: (tf: GpTimeframe) => void
  readonly ranges: readonly RangeCode[]
  readonly range: RangeCode | null
  readonly onRange: (range: RangeCode) => void
  /** Why a range cannot be requested at this timeframe, or null when it can. */
  readonly rangeBlocked: (range: RangeCode) => string | null
  readonly rolls: boolean
  readonly onRolls: () => void
  readonly rollsLabel: string
}

export function GpRangeRow(p: RangeRowProps) {
  return (
    <div className="gp-rangerow">
      {p.mode === 'GP' ? (
        <div className="chart-range" role="group" aria-label={C.rangeGroup}>
          {p.ranges.map((r) => (
            <Toggle key={r} label={r} pressed={p.range === r} onPress={() => p.onRange(r)} disabledReason={p.rangeBlocked(r)} />
          ))}
        </div>
      ) : null}
      <div className="chart-range" role="group" aria-label={C.barGroup}>
        {p.timeframes.map((tf) => (
          <Toggle key={tf} label={tf} pressed={p.tf === tf} onPress={() => p.onTf(tf)} />
        ))}
      </div>
      <div className="chart-range">
        <Toggle label={p.rollsLabel} pressed={p.rolls} onPress={p.onRolls} />
      </div>
    </div>
  )
}

/** The reason text for a range longer than one request may span, else null. */
export function spanReason(range: RangeCode, tf: GpTimeframe, allowed: boolean): string | null {
  if (allowed) return null
  const years = SPAN_CAP_YEARS[tf] ?? 0
  return fillCopy(years === 1 ? C.rangeTooLong : C.rangeTooLongPlural, { range, tf, years })
}
