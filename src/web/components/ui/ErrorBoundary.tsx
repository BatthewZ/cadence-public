import { Component } from "react";

interface Props {
  children: React.ReactNode;
  /** When any key changes, the error state is automatically reset.
   *  Useful for resetting on navigation (e.g., resetKeys={[pathname]}). */
  resetKeys?: unknown[];
  /** Optional custom fallback. Receives a reset function. */
  fallback?: (props: { reset: () => void }) => React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  private hmrHot?: { on: (event: string, cb: () => void) => void; off: (event: string, cb: () => void) => void };
  private hmrResetHandler?: () => void;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidMount() {
    // Auto-reset on Vite HMR so transient module-replacement errors
    // don't leave the boundary stuck in the error state.
    const hot = (import.meta as unknown as Record<string, unknown>).hot as
      | { on: (event: string, cb: () => void) => void; off: (event: string, cb: () => void) => void }
      | undefined;
    if (hot && typeof hot.on === 'function' && typeof hot.off === 'function') {
      this.hmrResetHandler = () => {
        if (this.state.hasError) {
          this.setState({ hasError: false });
        }
      };
      hot.on("vite:afterUpdate", this.hmrResetHandler);
      this.hmrHot = hot;
    }
  }

  componentWillUnmount() {
    if (this.hmrHot && this.hmrResetHandler) {
      this.hmrHot.off("vite:afterUpdate", this.hmrResetHandler);
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (!this.state.hasError) return;

    const prevKeys = prevProps.resetKeys ?? [];
    const nextKeys = this.props.resetKeys ?? [];

    const changed =
      prevKeys.length !== nextKeys.length ||
      prevKeys.some((key, i) => !Object.is(key, nextKeys[i]));

    if (changed) {
      this.setState({ hasError: false });
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback({ reset: this.handleReset });
      }

      return (
        <div className="flex items-center justify-center min-h-screen bg-surface-1">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-fg-secondary mb-6">An unexpected error occurred.</p>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-primary text-fg-on-primary rounded-md hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
