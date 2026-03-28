import { Link } from "react-router-dom";

function LandingFooter() {
  return (
    <footer className="border-t border-border-default bg-surface-0 px-6 py-8 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <span className="landing-display text-lg text-fg-primary">Cadence</span>
          <span className="text-xs text-fg-muted">
            Proof that tools can be fast, beautiful, and yours.
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/login"
            className="text-sm text-fg-secondary transition-colors hover:text-fg-primary"
          >
            Sign In
          </Link>
          <Link
            to="/register"
            className="text-sm text-fg-secondary transition-colors hover:text-fg-primary"
          >
            Register
          </Link>
        </div>
      </div>
    </footer>
  );
}

export { LandingFooter };
