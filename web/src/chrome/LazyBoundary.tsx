// An error boundary for an on-demand chunk (the key map overlay, the event tape): when the chunk cannot be
// fetched, the boundary renders nothing and tells its owner once, so the terminal around it stays up. The
// owner posts the words (src/copy/chrome.ts); this file holds none.
import { Component, type ReactNode } from 'react'

export interface LazyBoundaryProps {
  readonly onError: () => void
  readonly children: ReactNode
}

interface LazyBoundaryState {
  readonly failed: boolean
}

export class LazyBoundary extends Component<LazyBoundaryProps, LazyBoundaryState> {
  state: LazyBoundaryState = { failed: false }

  static getDerivedStateFromError(): LazyBoundaryState {
    return { failed: true }
  }

  componentDidCatch(): void {
    this.props.onError()
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
