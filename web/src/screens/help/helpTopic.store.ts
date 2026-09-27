// Which function's help HELP should show, as asked from elsewhere in the terminal (`MNEM HELP`, F1 on a
// screen). The HELP panel watches the request and opens that topic; each request carries a sequence
// number, so asking for the same topic twice opens it again after the user went back to the index.
import { create } from 'zustand'
import type { MnemonicCode } from '../../commands/registry'

export interface HelpTopicRequest {
  readonly code: MnemonicCode
  readonly seq: number
}

export interface HelpTopicState {
  readonly request: HelpTopicRequest | null
}

export const useHelpTopic = create<HelpTopicState>()(() => ({ request: null }))

/** Ask the HELP panel to show the help page of `code`. */
export function requestHelpTopic(code: MnemonicCode): void {
  const seq = (useHelpTopic.getState().request?.seq ?? 0) + 1
  useHelpTopic.setState({ request: { code, seq } })
}
