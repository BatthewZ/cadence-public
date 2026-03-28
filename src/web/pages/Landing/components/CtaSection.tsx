import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { ScrollReveal } from "@/web/components/animation/ScrollReveal";

import { RhythmBars } from "./ProductShowcase";

function CtaSection() {
  return (
    <section className="bg-surface-1 px-6 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-2xl text-center">
        <ScrollReveal animation="fade-up">
          <RhythmBars count={16} className="mx-auto mb-8 justify-center text-accent opacity-50" />

          <h2 className="landing-display mb-6 text-4xl text-fg-primary sm:text-5xl">
            Ready to find your rhythm?
          </h2>
          <p className="text-body-1 mx-auto mb-10 max-w-md text-fg-secondary">
            Deploy it once and it&apos;s yours — every feature, every seat, forever.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/register"
              className="group inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3.5 font-medium text-fg-on-primary transition-colors hover:bg-primary-hover"
            >
              Get Started Free
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/login"
              className="rounded-xl border border-border-strong px-7 py-3.5 font-medium text-fg-secondary transition-colors hover:border-fg-secondary hover:text-fg-primary"
            >
              Sign In
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

export { CtaSection };
