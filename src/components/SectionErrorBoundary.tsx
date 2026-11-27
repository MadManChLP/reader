import React, { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  /** Shown in the fallback, e.g. "the Admin page" */
  label?: string
  /** Change it to clear the error (e.g. the section id) */
  resetKey?: unknown
  children: React.ReactNode
}

interface State {
  error: Error | null
  resetKey: unknown
}

/**
 * Catches a render crash in one part of a view so it shows an inline error
 * instead of unmounting the whole app (React leaves a blank window when an
 * error reaches the root). Server responses that change shape are the usual
 * cause in the Requester.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey }
    return null
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[SectionErrorBoundary] ${this.props.label ?? 'section'} crashed:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="max-w-xl mx-auto my-10 p-5 rounded-xl bg-red-500/10 border border-red-500/20 text-sm">
        <div className="flex items-center gap-2 text-red-300 font-semibold mb-2">
          <AlertTriangle size={16} /> Couldn't show {this.props.label ?? 'this page'}
        </div>
        <p className="text-white/60 break-words">{error.message || String(error)}</p>
        <button type="button" onClick={() => this.setState({ error: null })}
          className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80">
          <RotateCcw size={14} /> Try again
        </button>
      </div>
    )
  }
}
