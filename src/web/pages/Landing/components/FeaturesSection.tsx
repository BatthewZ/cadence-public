import { ScrollReveal } from "@/web/components/animation/ScrollReveal";

import { FEATURES } from "./constants";

function FeaturesSection() {
  return (
    <section id="features" className="bg-surface-1 px-6 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal animation="fade-up">
          <div className="mb-16 max-w-2xl">
            <h2 className="text-h3 mb-4 text-fg-primary">Build with intention</h2>
            <p className="text-body-1 text-fg-secondary">
              Most project tools create more friction than they remove. Cadence is built for people
              who believe good tooling should get out of your way — not become another thing to
              manage.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <ScrollReveal key={feature.title} animation="fade-up" delay={i * 80}>
              <div className="flex gap-4">
                <div className="landing-feature-icon">
                  <feature.icon className="size-5" />
                </div>
                <div>
                  <h3 className="text-h6 mb-1 text-fg-primary">{feature.title}</h3>
                  <p className="text-body-2 text-fg-secondary">{feature.description}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export { FeaturesSection };
