import { Check, GripVertical } from "lucide-react";

import { ScrollReveal } from "@/web/components/animation/ScrollReveal";
import { cn } from "@/web/util/style/style";

import type { MockCard as MockCardType } from "./constants";
import { MOCK_COLUMNS, PRIORITY_DOT, RHYTHM_HEIGHTS } from "./constants";

function RhythmBars({ className, count = 12 }: { className?: string; count?: number }) {
  return (
    <div className={cn("landing-rhythm", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="landing-rhythm-bar"
          style={
            {
              "--bar-height": `${RHYTHM_HEIGHTS[i % RHYTHM_HEIGHTS.length]}%`,
              animationDelay: `${i * 0.12}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function MockCard({ card }: { card: MockCardType }) {
  const done = "done" in card && card.done;
  return (
    <div
      className={cn(
        "rounded-lg border border-border-default bg-surface-0 p-3 shadow-xs",
        done && "opacity-60"
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className={cn("text-xs font-medium text-fg-primary", done && "line-through")}>
          {card.title}
        </span>
        <GripVertical className="size-3 shrink-0 text-fg-muted" />
      </div>
      <div className="flex items-center justify-between">
        <span
          className="rounded-full px-2 py-0.5 text-[0.625rem] font-medium text-white"
          style={{ backgroundColor: card.label.color }}
        >
          {card.label.name}
        </span>
        <div className="flex items-center gap-1.5">
          {card.priority && !done && (
            <span className={cn("size-1.5 rounded-full", PRIORITY_DOT[card.priority])} />
          )}
          {"avatar" in card && card.avatar && (
            <span className="flex size-5 items-center justify-center rounded-full bg-surface-2 text-[0.5625rem] font-semibold text-fg-secondary">
              {card.avatar}
            </span>
          )}
          {done && <Check className="size-3.5 text-status-success" />}
        </div>
      </div>
    </div>
  );
}

function ProductShowcase() {
  return (
    <section className="bg-surface-1 px-6 pb-24 sm:px-8 sm:pb-32">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal animation="fade-up">
          <div className="mb-12 text-center">
            <h2 className="text-h3 mb-4 text-fg-primary">Designed to stay out of your way</h2>
            <p className="text-body-1 mx-auto max-w-xl text-fg-secondary">
              The best tool is the one you forget you're using. Open Cadence, see what matters, act
              on it, move on.
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal animation="fade-up" delay={120}>
          <div className="landing-showcase">
            <div className="relative">
              <div className="landing-showcase-glow" />

              <div className="landing-showcase-board rounded-xl border border-border-default bg-surface-0 shadow-lg">
                {/* Mock toolbar */}
                <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-fg-primary">Website Redesign</span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.625rem] text-fg-muted">
                      16 tasks
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {(["Board", "List", "Timeline"] as const).map((view, i) => (
                      <span
                        key={view}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs",
                          i === 0 ? "bg-accent/10 font-medium text-accent" : "text-fg-muted"
                        )}
                      >
                        {view}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Mock columns */}
                <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
                  {MOCK_COLUMNS.map((col) => (
                    <div key={col.title} className="min-w-0">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-fg-primary">{col.title}</span>
                          <span className="flex size-4 items-center justify-center rounded-full bg-surface-2 text-[0.625rem] text-fg-muted">
                            {col.count}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        {col.cards.map((card) => (
                          <MockCard key={card.title} card={card} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

export { MockCard, ProductShowcase, RhythmBars };
