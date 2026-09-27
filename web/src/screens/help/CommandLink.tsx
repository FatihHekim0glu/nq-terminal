// `{NQ1 Index GP <GO>}` as a command link (look spec 5.1 item 10): a --link button that runs the line
// through the command line on click or Enter, with the braces shown around it. Text that is not a
// command link renders as plain code. Each link is a roving item of its panel.
import { commandLinkLine, requestLine } from '../../chrome/CommandLine.bus'
import { KeyText } from '../../chrome/MessageLine'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'

const roving = { [ROVING_ATTR]: '' }

export interface CommandLinkProps {
  /** The link as written in copy: `{<line> <GO>}`. */
  readonly text: string
  /** Shift+Enter: open the result in a new panel. */
  readonly newPanel?: boolean
  /** A number shown before the link (a Number <GO> target), e.g. 41. */
  readonly n?: number
}

export default function CommandLink({ text, newPanel = false, n }: CommandLinkProps) {
  const line = commandLinkLine(text)
  if (!line) return <code>{text}</code>
  return (
    <span className="cmd-link-wrap">
      {n !== undefined ? <span className="hot">{`${n})`}</span> : null}
      <span aria-hidden="true">{'{'}</span>
      <button type="button" className="cmd-link" onClick={() => requestLine(line, newPanel)} {...roving}>
        <KeyText text={`${line} <GO>`} />
      </button>
      <span aria-hidden="true">{'}'}</span>
    </span>
  )
}
