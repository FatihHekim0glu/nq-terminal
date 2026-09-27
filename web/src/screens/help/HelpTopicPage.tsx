// One function's help page (look spec 7.12): the italic breadcrumb, the mnemonic in white at twice the
// body size, its screen name and summary in amber, the context, argument and build status it takes,
// then what it shows, where its numbers come from, the labels and limits that apply, numbered
// runnable examples (41 on) and related functions (51 on) whose help opens in place.
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { findMnemonic, type MnemonicCode } from '../../commands/registry'
import { ARGUMENT_NAMES } from '../../copy/commands'
import { HELP_TOPIC } from '../../copy/helpTopics'
import { fillCopy } from '../../copy/workspace'
import CommandLink from './CommandLink'
import { screenStatus } from './HelpIndex'
import { exampleNumbers, relatedNumbers, topicFor } from './helpTopics'

const roving = { [ROVING_ATTR]: '' }

export interface HelpTopicPageProps {
  readonly code: MnemonicCode
  readonly built: ReadonlySet<string>
  readonly onTopic: (code: MnemonicCode) => void
  readonly onIndex: () => void
}

function Facts({ code, built }: { readonly code: MnemonicCode; readonly built: ReadonlySet<string> }) {
  const { def } = topicFor(code)
  const context = def.context === 'none' ? HELP_TOPIC.noContext : def.context
  return (
    <dl className="help-facts">
      <dt>{HELP_TOPIC.context}</dt><dd>{context}</dd>
      <dt>{HELP_TOPIC.argument}</dt><dd>{ARGUMENT_NAMES[def.argument]}</dd>
      <dt>{HELP_TOPIC.status}</dt><dd>{screenStatus(def, built)}</dd>
    </dl>
  )
}

function Related({ code, onTopic }: { readonly code: MnemonicCode; readonly onTopic: HelpTopicPageProps['onTopic'] }) {
  const { copy } = topicFor(code)
  const numbers = relatedNumbers(copy)
  return (
    <ul className="help-related" aria-label={HELP_TOPIC.related}>
      {copy.related.map((r, i) => {
        const def = findMnemonic(r)
        if (!def) return null
        return (
          <li key={r}>
            <button type="button" className="help-related-btn" title={HELP_TOPIC.relatedHint} onClick={() => onTopic(def.code)} {...roving}>
              <span className="hot">{`${numbers[i]})`}</span> <span className="code">{def.code}</span> <span className="prose">{def.screen}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default function HelpTopicPage({ code, built, onTopic, onIndex }: HelpTopicPageProps) {
  const { def, copy } = topicFor(code)
  const examples = exampleNumbers(copy)
  return (
    <section className="help-topic" aria-label={fillCopy(HELP_TOPIC.topicLabel, { code })}>
      <p className="help-crumb">{fillCopy(HELP_TOPIC.crumb, { code })}</p>
      <h3 className="help-title">{def.code}</h3>
      <p className="help-screen-name">{def.screen}</p>
      <p className="help-intro">{copy.summary}</p>
      <Facts code={code} built={built} />
      <h4>{HELP_TOPIC.shows}</h4>
      <ul className="help-list">
        {copy.shows.map((s) => <li key={s}>{s}</li>)}
      </ul>
      <h4>{HELP_TOPIC.data}</h4>
      <p>{copy.data}</p>
      {copy.honesty ? (
        <>
          <h4>{HELP_TOPIC.honesty}</h4>
          <p>{copy.honesty}</p>
        </>
      ) : null}
      <h4>{HELP_TOPIC.examples}</h4>
      <p className="help-examples">
        {copy.examples.map((ex, i) => <CommandLink key={ex} text={ex} n={examples[i]} />)}
      </p>
      <h4>{HELP_TOPIC.related}</h4>
      <Related code={code} onTopic={onTopic} />
      <p>
        <button type="button" className="help-back" onClick={onIndex} {...roving}>{HELP_TOPIC.backToIndex}</button>
      </p>
    </section>
  )
}
