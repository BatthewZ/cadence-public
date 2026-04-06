# Design System

Foundation for the starter kit UI primitives. Every visual value in the system flows through a two-layer token architecture: **CSS custom properties** on `:root`, mapped to **Tailwind** via `@theme inline` blocks, consumed as **utility classes** in components.

## Documentation

- [Token Architecture](./token-architecture.md) -- two-layer token system, file structure, and how tokens flow from CSS variables to Tailwind utilities
- [Color Tokens](./colors.md) -- brand, surface, text, border, and status color tokens
- [Responsive Spacing](./spacing.md) -- six responsive spacing tokens (r1-r6) that scale at 640px
- [Typography](./typography.md) -- responsive font sizes, line heights, and font weights
- [Border Radius](./radius.md) -- border radius tokens from sm to full
- [Shadows](./shadows.md) -- elevation/shadow tokens (sm, md, lg)
- [Transitions](./transitions.md) -- interaction transition duration tokens
- [Motion Tokens](./motion.md) -- animation durations, easing curves, distances, and scale factors
- [Overlay Tokens](./overlays.md) -- scrims, gradients, and backdrop blur tokens
- [Media Tokens](./media.md) -- aspect ratios, hover effects, and carousel tokens
- [Theming](./theming.md) -- how theming works, creating themes, and built-in theme reference
- [Utilities](./utilities.md) -- the `cn()` utility function for class merging
- [Animations](./animations.md) -- built-in animation keyframes
- [Design Rules](./rules.md) -- coding standards, accessibility, component patterns, and organization

# Design Rules

### No hardcoded values

Every visual value must go through a CSS variable. Never hardcode `300ms`, `oklch(...)`, `8px`, or `scale(1.05)` in a component -- use the corresponding token.

### Mobile-first

Every component must work at 320px viewport width. Responsive tokens handle the scaling automatically via the 640px breakpoint. Complex layouts degrade gracefully on mobile.

### Accessibility

- All interactive components include ARIA roles, keyboard navigation, and focus management.
- All animation primitives respect `@media (prefers-reduced-motion: reduce)`.
- Focus ring: `ring-2 ring-border-focus ring-offset-2` is the consistent focus style across all interactive elements.

### No runtime CSS-in-JS

All styling uses Tailwind utility classes referencing CSS variable tokens. No JavaScript animation libraries. Animation is achieved via CSS animations, CSS transitions, IntersectionObserver, requestAnimationFrame, and the View Transitions API only.

### Component patterns

- Every component accepts a `className` prop merged via `cn()`.
- Components use `forwardRef` and spread remaining props onto the root element.
- Multi-part components use the **compound component pattern** (e.g. `Tabs`, `Tabs.List`, `Tabs.Tab`, `Tabs.Panel`).
- The `as` prop pattern (polymorphic components) is used on `Text`, `Stack`, `Row`, and `Button`.
- Components are slots, not opinions -- use `children`, render props, or compound components.

### Icons

Use [Lucide React](https://lucide.dev/icons/) for all icons.

### Component organization

| Directory                       | Contents                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/web/components/ui/`        | UI primitives (Button, Card, Badge, etc.) and display components (MediaCard, Hero, Carousel, etc.) |
| `src/web/components/layout/`    | Layout primitives (Stack, Row, Container, Spacer, Divider)                                         |
| `src/web/components/form/`      | Form components (Input, Field, Select, Checkbox, etc.)                                             |
| `src/web/components/animation/` | Animation primitives (ScrollReveal, Stagger, AnimatePresence, etc.)                                |
| `src/web/components/auth/`      | Auth page wrappers (AuthForm — shared form scaffold for Login, Register, ForgotPassword, ResetPassword) |
| `src/web/components/guards/`    | Route guards (AuthGuard, GuestGuard)                                                               |
