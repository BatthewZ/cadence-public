import {
  Menu,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/web/util/style/style";

function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={cn("landing-nav", scrolled && "landing-nav--scrolled")} aria-label="Landing">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-8">
        <Link to="/" className="landing-display text-xl text-white">
          Cadence
        </Link>

        <div className="hidden items-center gap-6 sm:flex">
          <a href="#features" className="text-sm text-white/60 transition-colors hover:text-white">
            Features
          </a>
          <a href="#themes" className="text-sm text-white/60 transition-colors hover:text-white">
            Themes
          </a>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="hidden text-sm text-white/70 transition-colors hover:text-white sm:inline-block"
          >
            Sign In
          </Link>
          <Link
            to="/register"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover"
          >
            Get Started
          </Link>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-2 text-white/70 transition-colors hover:text-white sm:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out sm:hidden",
          mobileOpen ? "max-h-60 opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 pb-5">
          <a
            href="#features"
            className="text-sm text-white/60 transition-colors hover:text-white"
            onClick={() => setMobileOpen(false)}
          >
            Features
          </a>
          <a
            href="#themes"
            className="text-sm text-white/60 transition-colors hover:text-white"
            onClick={() => setMobileOpen(false)}
          >
            Themes
          </a>
          <Link
            to="/login"
            className="text-sm text-white/60 transition-colors hover:text-white"
            onClick={() => setMobileOpen(false)}
          >
            Sign In
          </Link>
        </div>
      </div>
    </nav>
  );
}

export { LandingNav };
