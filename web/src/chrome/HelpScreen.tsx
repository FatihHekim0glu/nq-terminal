// HELP (UI_SPEC sections 5 and 7): the mnemonic index is generated from the command registry, so a
// new mnemonic shows here without editing this file. Keys, link groups and licences come from
// src/copy/help.ts. Phase 7.4 extends the content; the generated index stays.
import { MNEMONICS, screenNumber, type MnemonicCode, type MnemonicDef } from '../commands/registry'
import { HELP, HELP_KEYS, HELP_LICENCES } from '../copy/help'
import { fillCopy } from '../copy/workspace'
import { SCREEN_PHASES } from './WorkspaceLayouts'
import { ROVING_ATTR } from './WorkspaceFocus'
import './HelpScreen.css'

export interface HelpScreenProps {
  /** Mnemonics whose screen is built; the rest are listed as placeholders. */
  readonly built: ReadonlySet<MnemonicCode | string>
  /** The index to list; the registry unless a test passes another. */
  readonly mnemonics?: readonly MnemonicDef[]
}

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
        {mnemonics.map((m) => (
          <tr key={m.code} data-built={built.has(m.code) ? 'true' : 'false'}>
            <td className="ix">{screenNumber(m.code)}</td>
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

function KeyTable() {
  return (
    <table className="help-table">
      <caption>{HELP.keysCaption}</caption>
      <thead>
        <tr><th scope="col">{HELP.keyColumns.key}</th><th scope="col">{HELP.keyColumns.action}</th></tr>
      </thead>
      <tbody>
        {HELP_KEYS.map(([key, action]) => (
          <tr key={key}><th scope="row" className="code">{key}</th><td className="prose">{action}</td></tr>
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
        <a href={HELP.tradingViewUrl} target="_blank" rel="noopener noreferrer" {...{ [ROVING_ATTR]: '' }}>
          {HELP.tradingViewLink}
          {' '}<span className="sr-only">{HELP.newTab}</span>
        </a>
      </p>
      <ul className="help-licences">
        {HELP_LICENCES.map(([name, licence]) => (
          <li key={name}><span>{name}</span> <span className="muted">{licence}</span></li>
        ))}
      </ul>
    </>
  )
}

export default function HelpScreen({ built, mnemonics = MNEMONICS }: HelpScreenProps) {
  return (
    <div className="help">
      <p className="help-intro">{HELP.intro}</p>
      <h3 className="eyebrow">{HELP.grammarHeading}</h3>
      <p className="mono">{HELP.grammar}</p>
      <p className="help-examples">
        <span className="muted">{HELP.examplesLabel}: </span>
        {HELP.examples.map((ex) => (
          <code key={ex}>{ex}</code>
        ))}
      </p>
      <h3 className="eyebrow">{HELP.mnemonicsHeading}</h3>
      <MnemonicIndex mnemonics={mnemonics} built={built} />
      <h3 className="eyebrow">{HELP.keysHeading}</h3>
      <KeyTable />
      <h3 className="eyebrow">{HELP.linkHeading}</h3>
      <p>{HELP.linkText}</p>
      <h3 className="eyebrow">{HELP.licencesHeading}</h3>
      <Licences />
    </div>
  )
}
