import { Layers, Palette, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useForceDefaultTheme } from "@/web/hooks/use-force-default-theme";
import { cn } from "@/web/util/style/style";

/* ─── Rhythm bar visualization (same as landing) ─── */

const RHYTHM_HEIGHTS = [35, 65, 45, 80, 55, 90, 40, 70, 50, 85, 45, 75];

function RhythmBars() {
  return (
    <div className="landing-rhythm mt-6 text-accent opacity-50">
      {RHYTHM_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className="landing-rhythm-bar"
          style={
            {
              "--bar-height": `${h}%`,
              animationDelay: `${i * 0.12}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* ─── Feature highlights for left panel ─── */

const AUTH_FEATURES = [
  { icon: Sparkles, text: "Simple by default — it just works" },
  { icon: Palette, text: "14 handcrafted themes to make it yours" },
  { icon: Layers, text: "Board, list, and timeline views" },
];

/* ─── Main layout ─── */

type AuthLayoutProps = {
  children: ReactNode;
  className?: string;
};

export function AuthLayout({ children, className }: AuthLayoutProps) {
  useForceDefaultTheme();

  return (
    <div className="auth-layout">
      {/* ── Mobile header ── */}
      <div className="auth-mobile-header">
        <Link
          to="/"
          className="text-lg text-white"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Cadence
        </Link>
        <div
          className="landing-rhythm hidden text-accent opacity-40 sm:flex"
          style={{ height: 24 }}
        >
          {RHYTHM_HEIGHTS.slice(0, 6).map((h, i) => (
            <div
              key={i}
              className="landing-rhythm-bar"
              style={
                {
                  "--bar-height": `${h}%`,
                  animationDelay: `${i * 0.12}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>

      {/* ── Branded left panel (desktop only) ── */}
      <div className="auth-brand-panel" aria-hidden="true">
        {/* Background orbs */}
        <div
          className="landing-orb"
          style={{
            width: 400,
            height: 400,
            background: "var(--C-ACCENT)",
            opacity: 0.12,
            top: "-15%",
            right: "-10%",
            filter: "blur(80px)",
            animation: "landing-float 25s ease-in-out infinite",
          }}
        />
        <div
          className="landing-orb"
          style={{
            width: 300,
            height: 300,
            background: "oklch(0.5413 0.2466 293.01)",
            opacity: 0.08,
            bottom: "-10%",
            left: "-5%",
            filter: "blur(80px)",
            animation: "landing-float 30s ease-in-out infinite reverse",
          }}
        />

        {/* Grid */}
        <div className="landing-grid" />

        {/* Content */}
        <div className="relative z-10 max-w-sm">
          <Link
            to="/"
            className="mb-3 block text-3xl text-white"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Cadence
          </Link>
          <p className="text-lg leading-relaxed text-white/55">
            Beautiful tools that get out of your way — so you can focus on the
            work that matters to you.
          </p>

          <RhythmBars />

          <div className="mt-12 flex flex-col gap-4">
            {AUTH_FEATURES.map((f) => (
              <div key={f.text} className="auth-feature-item">
                <div className="auth-feature-check">
                  <f.icon className="size-3" />
                </div>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className={cn("auth-form-panel", className)}>
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
