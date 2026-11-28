import { Component, type ReactNode } from "react";

/** Keeps a rendering error from blanking the whole app during a live demo. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[QFleet] ${this.props.label ?? "view"} crashed`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="absolute inset-0 z-[80] grid place-items-center bg-void/80 backdrop-blur-sm">
        <div className="glass-strong rounded-2xl p-6 text-center max-w-md">
          <div className="font-display text-lg tracking-[0.14em] grad-text font-black">RECOVERING</div>
          <p className="text-dim text-sm mt-2">Something went wrong while drawing this panel: {this.state.error.message}</p>
          <div className="mt-4 flex gap-2 justify-center">
            <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
            <button className="btn-quantum" onClick={() => window.location.reload()}>Reload app</button>
          </div>
        </div>
      </div>
    );
  }
}
