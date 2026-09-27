// HELP (TASKS 7.4, look spec 7.12): what the workspace registers. HelpScreen takes the same props as the
// Phase 4 HelpScreen ({ built, mnemonics? }) and adds one page per function (copy/helpTopics.ts);
// requestHelpTopic(code) asks an open HELP panel to show that page (for `MNEM HELP` and F1).
export { default as HelpScreen, type HelpScreenProps } from './HelpScreen'
export { default as CommandLink } from './CommandLink'
export { requestHelpTopic, useHelpTopic } from './helpTopic.store'
export { topicFor } from './helpTopics'

/** The mnemonic this folder serves, for the screen registry. */
export const HELP_MNEMONIC = 'HELP' as const
