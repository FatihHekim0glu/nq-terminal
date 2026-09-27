// A HELP page's data: the mnemonic's registry definition joined with its copy (copy/helpTopics.ts),
// and the Number <GO> numbers on the page. The mnemonic index takes 1 to 30, so a page numbers its
// examples from 41 and its related functions from 51 (look spec 7.12 shows `41) Examples`).
import { findMnemonic, type MnemonicCode, type MnemonicDef } from '../../commands/registry'
import { HELP_TOPICS, type HelpTopicCopy } from '../../copy/helpTopics'

export const FIRST_EXAMPLE = 41
export const FIRST_RELATED = 51

export interface HelpTopic {
  readonly def: MnemonicDef
  readonly copy: HelpTopicCopy
}

const EMPTY: HelpTopicCopy = { summary: '', shows: [], data: '', examples: [], related: [] }

/** The page for `code`; a code with no copy gets an empty page rather than a crash. */
export function topicFor(code: MnemonicCode): HelpTopic {
  return { def: findMnemonic(code) as MnemonicDef, copy: HELP_TOPICS[code] ?? EMPTY }
}

export function exampleNumbers(copy: HelpTopicCopy): number[] {
  return copy.examples.map((_, i) => FIRST_EXAMPLE + i)
}

export function relatedNumbers(copy: HelpTopicCopy): number[] {
  return copy.related.map((_, i) => FIRST_RELATED + i)
}
