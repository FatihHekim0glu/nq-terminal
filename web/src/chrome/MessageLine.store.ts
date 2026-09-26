// The message line's one message (spec 4.2): whatever the command line, the key toolbar or a global
// key last said. `id` changes with every post, so a repeated message renders a fresh node and is
// announced again. An error is dropped when the line is edited or left; a notice stays until replaced.
import { create } from 'zustand'

export type MessageTone = 'info' | 'error'

export interface MessageState {
  readonly text: string
  readonly tone: MessageTone
  readonly id: number
}

const EMPTY: MessageState = { text: '', tone: 'info', id: 0 }

export const useMessage = create<MessageState>()(() => EMPTY)

export function postMessage(text: string, tone: MessageTone = 'info'): void {
  useMessage.setState((prev) => ({ text, tone, id: prev.id + 1 }))
}

/** Clears the message when it has `tone` (an edit clears an error, never a notice). */
export function clearMessage(tone: MessageTone): void {
  if (useMessage.getState().tone !== tone || useMessage.getState().text === '') return
  useMessage.setState((prev) => ({ text: '', tone: 'info', id: prev.id + 1 }))
}

/** Back to the empty state (tests). */
export function resetMessage(): void {
  useMessage.setState(EMPTY, true)
}
