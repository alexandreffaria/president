import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches a rendering error anywhere below it and shows what happened with a way out,
 * instead of an empty page. `inPage` boundaries sit inside the page's `<main>`, so their
 * message is a plain block rather than a second `main` landmark.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; inPage?: boolean },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("president UI error:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const message = (
      <div className="empty" role="alert">
        <p>Something went wrong while showing this page.</p>
        <p className="muted small">{this.state.error.message}</p>
        <p>
          <a href="/">Go to the queue</a>
        </p>
      </div>
    );
    return this.props.inPage ? message : <main className="main">{message}</main>;
  }
}
