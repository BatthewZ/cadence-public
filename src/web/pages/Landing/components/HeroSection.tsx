import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { RhythmBars } from "./ProductShowcase";

function GradientOrbs() {
  return (
    <>
      <div className="landing-orb landing-orb--1" aria-hidden="true" />
      <div className="landing-orb landing-orb--2" aria-hidden="true" />
      <div className="landing-orb landing-orb--3" aria-hidden="true" />
    </>
  );
}

function SectionWave({ fill }: { fill: string }) {
  return (
    <div className="landing-wave" aria-hidden="true">
      <svg viewBox="0 0 1440 48" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0 16C240 40 480 48 720 40C960 32 1200 8 1440 16V48H0Z" fill={fill} />
      </svg>
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative flex min-h-screen items-center overflow-hidden bg-primary">
      <GradientOrbs />
      <div className="landing-grid" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-32 sm:px-8">
        <div className="max-w-3xl">
          <div className="mb-6 flex items-center gap-4">
            <RhythmBars count={8} className="text-accent opacity-60" />
            <span className="text-xs font-medium uppercase tracking-widest text-white/40">
              Crafted for focus
            </span>
          </div>

          <h1 className="landing-display mb-6 text-5xl leading-[1.1] text-white sm:text-6xl lg:text-7xl">
            Find your
            <br />
            <span className="text-accent">rhythm</span>
          </h1>

          <p className="mb-10 max-w-xl text-lg leading-relaxed text-white/55">
            Fast, beautiful, and yours. Cadence is project management that disappears into the work
            — so you can focus on what matters.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <Link
              to="/register"
              className="group inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3.5 font-medium text-fg-on-accent transition-colors hover:bg-accent-hover"
            >
              Get Started Free
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#features"
              className="rounded-xl border border-white/20 px-6 py-3.5 font-medium text-white/75 transition-colors hover:border-white/40 hover:text-white"
            >
              See Features
            </a>
          </div>
        </div>
      </div>

      <SectionWave fill="var(--C-SURFACE-1)" />
    </section>
  );
}

export { GradientOrbs, HeroSection, SectionWave };
