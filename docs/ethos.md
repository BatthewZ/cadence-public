# Cadence — North Star

## Context

Cadence is a production project management platform built on Cloudflare's edge infrastructure. The project has reached a mature state — core task management, collaboration, notifications, multi-view layouts, and a polished design system are all in place. This document defines the guiding principles that shape every decision going forward: what we build, how we build it, and why.

---

## The Belief

Most project management tools start as someone's answer to "how do we organize work?" and end up as bloated, slow, expensive platforms that create more friction than they remove. They lock your data behind per-seat pricing. They optimize for enterprise sales, not user experience. They treat speed and beauty as luxuries, not requirements.

**We believe good tooling should be available to everyone who wants it.**

Cadence exists because great software is rare, and it doesn't have to be.

---

## Guiding Principles

### 1. Ownership, Not Rental

Teams should own their tools and their data. Cadence is architected so your data lives in infrastructure you control — your Workers, your D1 database, your R2 storage. There's no black box between you and your work. No per-seat tax that punishes you for growing. No "please export your data" when you want to leave.

**This means:** The architecture always supports data sovereignty. We never introduce hard dependencies on services users can't control or inspect. Whether hosted or self-deployed, users should always be able to access and own their data.

### 2. Craft Is Not Optional

Speed, clarity, beauty, and reliability are not tradeoffs — they are all required, all the time. Every interaction should feel instant. Every screen should be immediately understandable. Every animation should feel intentional. Every action should do what you expect.

**This means:** We don't ship "good enough." Optimistic updates, skeleton loaders, accessible components, and thoughtful empty states aren't polish — they're the product. If it doesn't feel right, it's not done.

### 3. Disappear Into the Work

The best tool is the one you forget you're using. Cadence should create rhythm, not interrupt it. When someone opens Cadence, they should spend their time *thinking about their work*, not thinking about the tool.

**This means:** Fewer configuration screens, fewer modals, fewer "are you sure?" prompts. Sensible defaults over infinite options. Structure that guides without constraining. The UI should teach by being obvious, not by showing tutorials.

### 4. Universal by Design

Cadence is for anyone with projects — a two-person startup, a freelance designer, a school group, a 200-person company. We don't gatekeep by role, team size, or technical sophistication. The hierarchy (Workspaces, Projects, Task Groups, Tasks) should feel natural whether you're shipping software or planning an event.

**This means:** Language stays simple and jargon-free. Features work without specialized knowledge. The onboarding path is the same whether you're a CTO or a first-time user. Accessibility isn't an afterthought — it's how we make universal real.

### 5. Honest Architecture

The technology choices are the product. A single Cloudflare Worker serving everything from the edge isn't a shortcut — it's a statement that simplicity scales. SQLite on D1 isn't a compromise — it's a database that doesn't need a DBA. Shared Zod schemas aren't cleverness — they're a guarantee that what you see is what exists.

**This means:** We don't add infrastructure to seem serious. We don't split services until we must. We don't adopt technologies for their resume value. Every dependency earns its place. The architecture should be explainable to a junior developer in five minutes.

---

## What We're Trying to Unlock

**For individuals:** A tool that respects your time and attention. You open it, you see what matters, you act on it, you move on.

**For teams:** Shared visibility without shared overhead. Everyone knows what's happening, who's doing what, and what's next — without status meetings or spreadsheet wrangling.

**For the ecosystem:** Proof that software can be fast, beautiful, affordable, and yours. That independent doesn't mean inferior. That "free for small teams" doesn't mean "ugly until you pay."

---

## How Users Should Feel

| Moment | Feeling |
|---|---|
| First load | "That was instant." |
| Creating their first project | "I didn't need instructions." |
| Dragging a task to Done | Satisfying. A small moment of progress made tangible. |
| Checking the dashboard Monday morning | Oriented. They know exactly where they stand. |
| Inviting a teammate | "They'll figure this out in two minutes." |
| Using it after 6 months | It still feels fast. It never got in the way. |

---

## Pain Points We Solve

1. **"This tool is slow."** Edge-native architecture means sub-100ms responses, globally. No loading spinners as a way of life.

2. **"This costs too much."** Edge-native architecture keeps infrastructure costs minimal. No per-seat pricing model that punishes growth.

3. **"I can't get my data out."** Your data is never held hostage. The architecture ensures you always have access to what's yours.

4. **"My team won't adopt it."** If the tool is fast, clear, and obvious, adoption isn't a change management problem — it's a non-event.

5. **"I need X feature from Tool Y."** We build what matters — boards, lists, timelines, tasks, subtasks, comments, notifications, activity tracking, file attachments. Not everything, but everything that counts.

6. **"It works for engineers but not for everyone else."** Simple language, visual workflows, no technical jargon. A designer, a marketer, and a developer should all feel at home.

---

## Decision Filter

When evaluating any feature, design choice, or architectural decision, run it through these questions:

1. **Does it respect ownership?** Does this keep data and control with the user?
2. **Does it meet the craft bar?** Is it fast, clear, beautiful, *and* reliable — not just one?
3. **Does it disappear?** Will this reduce friction, or add a new thing to learn?
4. **Does it work for everyone?** Can a non-technical user understand this without help?
5. **Is the architecture honest?** Is this the simplest thing that works, or are we over-engineering?

If the answer to any of these is no, we either redesign it or we don't build it.

---

## What We Don't Do

- **We don't chase feature parity.** Jira has 10,000 features. Most of them make Jira worse. We build what creates flow, not what fills a comparison chart.
- **We don't optimize for enterprise sales.** No "contact us for pricing" gates. No features held hostage behind tiers.
- **We don't sacrifice speed for features.** If a feature makes the app slower for everyone, it needs a different implementation or it doesn't ship.
- **We don't add complexity to seem powerful.** Power comes from doing common things effortlessly, not from exposing every possible configuration.

---

*Cadence: the steady rhythm of work getting done.*
