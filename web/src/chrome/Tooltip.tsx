// Plain UI tooltips (look spec 4.5, IS-11): white box, 1px dark edge, dark 11px text, placed
// 12px right of and 20px below the pointer tip, shown 500ms after the pointer rests and hidden in the
// frame it leaves; no fade and no shadow. Keyboard focus shows it at once, beside the control.
// WCAG 1.4.13: Escape dismisses it without moving focus, the pointer may move onto it, and it stays
// until the pointer or focus leaves.
import { cloneElement, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

export const TOOLTIP_DELAY_MS = 500
const POINTER_DX = 12
const POINTER_DY = 20
const FOCUS_GAP = 4

interface TriggerProps {
  readonly 'aria-describedby'?: string
  readonly onPointerMove?: (e: PointerEvent<HTMLElement>) => void
  readonly onPointerLeave?: (e: PointerEvent<HTMLElement>) => void
  readonly onFocus?: (e: FocusEvent<HTMLElement>) => void
  readonly onBlur?: (e: FocusEvent<HTMLElement>) => void
  readonly onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
}

export interface TooltipProps {
  readonly text: string
  readonly children: ReactElement<TriggerProps>
}

interface Place {
  readonly left: number
  readonly top: number
}

function contains(el: Element | null, target: EventTarget | null): boolean {
  return el !== null && target instanceof Node && el.contains(target)
}

export default function Tooltip({ text, children }: TooltipProps) {
  const id = useId()
  const [place, setPlace] = useState<Place | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clear, [])
  const hide = () => {
    clear()
    setPlace(null)
  }
  // Escape must dismiss a tip shown by pointer hover too, even while focus sits elsewhere (the command
  // line, another control): the trigger's own onKeyDown only fires when the trigger has focus (D15).
  useEffect(() => {
    if (!place) return
    // The DOM's own KeyboardEvent, not React's (the import above names the synthetic one).
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      hide()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place])
  const own = children.props

  const trigger = cloneElement(children, {
    'aria-describedby': place ? id : own['aria-describedby'],
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      own.onPointerMove?.(e)
      if (place) return
      clear()
      const at = { left: e.clientX + POINTER_DX, top: e.clientY + POINTER_DY }
      timer.current = setTimeout(() => setPlace(at), TOOLTIP_DELAY_MS)
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      own.onPointerLeave?.(e)
      if (contains(tipRef.current, e.relatedTarget)) return
      hide()
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      own.onFocus?.(e)
      const rect = e.currentTarget.getBoundingClientRect()
      clear()
      setPlace({ left: rect.left, top: rect.bottom + FOCUS_GAP })
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      own.onBlur?.(e)
      hide()
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape' && place) {
        e.preventDefault()
        e.stopPropagation()
        hide()
        return
      }
      own.onKeyDown?.(e)
    },
  })

  return (
    <>
      {trigger}
      {place
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              className="tip"
              style={{ left: `${place.left}px`, top: `${place.top}px` }}
              onPointerLeave={(e) => {
                if (e.relatedTarget instanceof Node && tipRef.current?.contains(e.relatedTarget)) return
                hide()
              }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
