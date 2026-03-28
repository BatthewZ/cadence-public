import { ScrollReveal } from "@/web/components/animation/ScrollReveal";

import { REMAINING_THEMES, THEMES } from "./constants";
import { GradientOrbs } from "./HeroSection";

function ThemesSection() {
  return (
    <section
      id="themes"
      className="relative overflow-hidden bg-primary px-6 py-24 sm:px-8 sm:py-32"
    >
      <GradientOrbs />
      <div className="landing-grid" aria-hidden="true" />

      <div className="relative z-10 mx-auto max-w-6xl">
        <ScrollReveal animation="fade-up">
          <div className="mb-16 max-w-2xl">
            <h2 className="landing-display mb-4 text-4xl text-white sm:text-5xl">
              Your project, your palette.
            </h2>
            <p className="text-lg leading-relaxed text-white/55">
              Every theme is crafted end-to-end — colors, typography, spacing, and motion all tuned
              to feel cohesive. Pick one, or let each project choose its own.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-5">
          {THEMES.map((theme, i) => (
            <ScrollReveal key={theme.name} animation="fade-up" delay={i * 60}>
              <div className="landing-theme-card overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm">
                {/* Color strip */}
                <div className="flex h-16">
                  {theme.colors.map((color, ci) => (
                    <div key={ci} className="flex-1" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <div className="px-3 py-2.5">
                  <span className="text-xs font-medium text-white/80">{theme.name}</span>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal animation="fade-up" delay={200}>
          <p className="mt-8 text-center text-sm text-white/40">
            + {REMAINING_THEMES.length} more themes including {REMAINING_THEMES.join(", ")}
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}

export { ThemesSection };
