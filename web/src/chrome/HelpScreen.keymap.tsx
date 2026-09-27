// The keyboard map (spec 7.12): a drawn keyboard (an image with a text alternative) and the key table
// it stands for. HELP shows both; the Alt+K overlay shows them too. Key caps follow the house colours:
// CANCEL red, GO keys green, sector keys yellow, PANEL cyan, the rest plain.
import { HELP, HELP_KEYBOARD, HELP_KEYS } from '../copy/help'
import './HelpScreen.keymap.css'

export function KeyboardDrawing() {
  return (
    <div className="kbd-drawing" role="img" aria-label={HELP.keyboardLabel}>
      {HELP_KEYBOARD.map((k) => (
        <span key={k.key} className="kbd-key" data-key={k.key} data-colour={k.colour}>
          <span className="kbd-cap">{k.cap}</span>
          <span className="kbd-name">{k.substitute ? `${k.key} (${HELP.substitute})` : k.key}</span>
        </span>
      ))}
    </div>
  )
}

export function KeyTable() {
  return (
    <table className="help-table">
      <caption>{HELP.keysCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{HELP.keyColumns.key}</th>
          <th scope="col">{HELP.keyColumns.action}</th>
        </tr>
      </thead>
      <tbody>
        {HELP_KEYS.map(([key, action]) => (
          <tr key={key}>
            <th scope="row" className="code">{key}</th>
            <td className="prose">{action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
