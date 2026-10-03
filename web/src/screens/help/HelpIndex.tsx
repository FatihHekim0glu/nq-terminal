// The HELP index page (look spec 7.12, UI_SPEC sections 5 and 7): intro, grammar with runnable
// examples, the numbered mnemonic index (generated from the command registry, so a new mnemonic shows
// here without editing this file), the keys, the drawn keyboard, link groups and licences. Every font
// listed is under an open licence.
import { PORTABLE_LINK_COPY } from '../../chrome/copyLink'
import { KeyboardDrawing, KeyTable } from '../../chrome/HelpScreen.keymap'
import { KeyText } from '../../chrome/MessageLine'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import type { MnemonicDef } from '../../commands/registry'
import { HELP, HELP_FONT_LICENCES, HELP_LICENCES } from '../../copy/help'
import { fillCopy } from '../../copy/workspace'
import { SCREEN_PHASES } from '../layouts/layouts'
import CommandLink from './CommandLink'

const roving = { [ROVING_ATTR]: '' }

// Bergoom is listed only when its files are vendored (decision D2 falls back to Source Sans 3 alone).
const BERGOOM_VENDORED = Object.keys(import.meta.glob('../../assets/fonts/bergoom/*.woff2')).length > 0
const FONT_LICENCES = [...(BERGOOM_VENDORED ? [HELP_FONT_LICENCES.bergoom] : []), HELP_FONT_LICENCES.sourceSans, HELP_FONT_LICENCES.ptMono]
export const LICENCES: ReadonlyArray<readonly [string, string]> = [...HELP_LICENCES, ...FONT_LICENCES]

/** `built`, or the placeholder's build phase or priority. */
export function screenStatus(def: MnemonicDef, built: ReadonlySet<string>): string {
  if (built.has(def.code)) return HELP.statusBuilt
  if (def.priority === 'P1') return HELP.statusP1
  if (def.priority === 'P2') return HELP.statusP2
  return fillCopy(HELP.statusPhase, { phase: SCREEN_PHASES[def.code] ?? '?' })
}

function MnemonicIndex({ mnemonics, built }: { readonly mnemonics: readonly MnemonicDef[]; readonly built: ReadonlySet<string> }) {
  const c = HELP.columns
  return (
    <table className="help-table">
      <caption>{HELP.mnemonicsCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{c.number}</th><th scope="col">{c.code}</th><th scope="col">{c.screen}</th>
          <th scope="col">{c.context}</th><th scope="col">{c.priority}</th><th scope="col">{c.status}</th>
        </tr>
      </thead>
      <tbody>
        {mnemonics.map((m, i) => (
          <tr key={m.code} data-built={built.has(m.code) ? 'true' : 'false'}>
            <td className="ix"><span className="hot">{`${i + 1})`}</span></td>
            <th scope="row" className="code">{m.code}</th>
            <td className="prose">{m.screen}</td>
            <td className="muted">{m.context}</td>
            <td className="muted">{m.priority}</td>
            <td className="status">{screenStatus(m, built)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Licences() {
  return (
    <>
      <p>{HELP.tradingView}</p>
      <p>
        <a href={HELP.tradingViewUrl} target="_blank" rel="noopener noreferrer" {...roving}>
          {HELP.tradingViewLink}
          {' '}<span className="sr-only">{HELP.newTab}</span>
        </a>
      </p>
      <ul className="help-licences" aria-label={HELP.licencesHeading}>
        {LICENCES.map(([name, licence]) => (
          <li key={name}><span>{name}</span> <span className="muted">{licence}</span></li>
        ))}
      </ul>
    </>
  )
}

export interface HelpIndexProps {
  readonly mnemonics: readonly MnemonicDef[]
  readonly built: ReadonlySet<string>
}

export default function HelpIndex({ mnemonics, built }: HelpIndexProps) {
  return (
    <>
      <p className="help-crumb">{HELP.crumb}</p>
      <h3 className="help-title">{HELP.title}</h3>
      <p className="help-intro">{HELP.intro}</p>
      <h4>{HELP.grammarHeading}</h4>
      <p className="help-grammar"><KeyText text={HELP.grammar} /></p>
      <p className="help-examples">
        <span className="muted">{HELP.examplesLabel}: </span>
        {HELP.examples.map((ex) => <CommandLink key={ex} text={ex} />)}
      </p>
      <h4 data-section="mnemonics">{HELP.mnemonicsHeading}</h4>
      <MnemonicIndex mnemonics={mnemonics} built={built} />
      <h4 data-section="keys">{HELP.keysHeading}</h4>
      <KeyTable />
      <h4 data-section="keyboard">{HELP.keyboardHeading}</h4>
      <KeyboardDrawing />
      <h4 data-section="links">{HELP.linkHeading}</h4>
      <p>{HELP.linkText}</p>
      <h4>{PORTABLE_LINK_COPY.helpHeading}</h4>
      <p>{PORTABLE_LINK_COPY.helpFixed}</p>
      <p>{PORTABLE_LINK_COPY.helpPortable}</p>
      <h4 data-section="licences">{HELP.licencesHeading}</h4>
      <Licences />
    </>
  )
}
