// ScreenBoundary: catches an error thrown while a screen renders, so one bad record degrades one panel to an
// alert instead of unmounting the whole terminal. `resetKey` names the screen and its context; when it changes
// (another command, another subject), the boundary draws the screen again.
import { Component, type ReactNode } from 'react'
import { WORKSPACE, fillCopy } from '../copy/workspace'

export interface ScreenBoundaryProps {
  readonly resetKey: string
  readonly children: ReactNode
}

interface ScreenBoundaryState {
  readonly error: Error | null
  readonly key: string
}

export default class ScreenBoundary extends Component<ScreenBoundaryProps, ScreenBoundaryState> {
  state: ScreenBoundaryState = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<ScreenBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(props: ScreenBoundaryProps, state: ScreenBoundaryState): Partial<ScreenBoundaryState> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <p className="ws-empty" role="alert">
          {fillCopy(WORKSPACE.screenFailed, { detail: this.state.error.message })}
        </p>
      )
    }
    return this.props.children
  }
}
