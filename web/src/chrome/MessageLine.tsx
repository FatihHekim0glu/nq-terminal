// The message line (spec 4.2): a 21px PT Mono row under the command box for prompts and status, in
// place of toasts. The live region holds only real messages (polite); the idle prompt sits beside it,
// hidden from assistive technology, so returning to idle is never announced. `<Key>` tokens are
// coloured by key group (spec 5.1 item 11): GO keys green, CANCEL red, sector keys yellow.
import { MESSAGES } from '../copy/chrome'
import { useMessage } from './MessageLine.store'
import './MessageLine.css'

export type KeyGroup = 'go' | 'cancel' | 'sector'

export interface KeyToken {
  readonly text: string
  readonly key: KeyGroup | null
}

const GO_KEYS = new Set(['GO', 'HELP', 'SEARCH', 'MENU', 'PG BACK', 'PG FWD', 'BACK', 'END', 'PGDN', 'PGUP', 'ENTER', 'HOME', 'F1', 'NO', 'ALT+K'])
const ESC_KEY_NAMES = new Set(['CANCEL', 'ESC'])
const SECTOR_KEY_NAMES = new Set(['F8', 'F9', 'F10', 'F11', 'INDEX', 'COMDTY', 'CURNCY', 'EQUITY'])

function keyGroup(name: string): KeyGroup | null {
  const upper = name.toUpperCase()
  if (ESC_KEY_NAMES.has(upper)) return 'cancel'
  if (SECTOR_KEY_NAMES.has(upper)) return 'sector'
  return GO_KEYS.has(upper) ? 'go' : null
}

/** Splits text into plain runs and `<Key>` tokens; a bracketed phrase that is not a key stays plain. */
export function keyTokens(text: string): KeyToken[] {
  const out: KeyToken[] = []
  let last = 0
  for (const m of text.matchAll(/<([^<>]+)>/g)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at), key: null })
    out.push({ text: m[0], key: keyGroup(m[1] ?? '') })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), key: null })
  return out
}

/** Text with its `<Key>` tokens coloured; used by the message line and the status line hint. */
export function KeyText({ text }: { readonly text: string }) {
  return (
    <>
      {keyTokens(text).map((t, i) =>
        t.key ? (
          <span key={i} className={`key-${t.key}`}>
            {t.text}
          </span>
        ) : (
          t.text
        ),
      )}
    </>
  )
}

export interface MessageLineProps {
  readonly id?: string
}

export function MessageLine({ id }: MessageLineProps) {
  const message = useMessage()
  return (
    <div className="msg-row">
      <p id={id} className="msg-line" role="status" aria-live="polite" data-tone={message.tone}>
        {message.text ? (
          <span key={message.id}>
            <KeyText text={message.text} />
          </span>
        ) : null}
      </p>
      {message.text ? null : (
        <p className="msg-idle" aria-hidden="true">
          <KeyText text={MESSAGES.idle} />
        </p>
      )}
    </div>
  )
}
