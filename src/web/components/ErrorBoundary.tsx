import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches a rendering error anywhere below it and shows what happened with a way out,
 * instead of an empty page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("president UI error:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="main">
        <div className="empty" role="alert">
          <p>Something went wrong while showing this page.</p>
          <p className="muted small">{this.state.error.message}</p>
          <p>
            <a href="/">Go to the queue</a>
          </p>
        </div>
      </main>
    );
  }
}
