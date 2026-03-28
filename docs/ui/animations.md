# Animation Components

Behavioral wrappers that control how and when other components appear, move, and transition. These primitives have no visual opinion of their own -- they orchestrate CSS animations, IntersectionObserver, requestAnimationFrame, and the View Transitions API.

**Shared rules for all animation primitives:**

- Respect `prefers-reduced-motion: reduce` -- disable or minimize all motion.
- Accept `className` for composition.
- Use `forwardRef`.
- No JS animation libraries -- CSS animations + IntersectionObserver + requestAnimationFrame + View Transitions API only.

---

## ScrollReveal

IntersectionObserver-based wrapper that animates children into view when they scroll into the viewport.

**Source:** `src/web/components/animation/ScrollReveal.tsx`

### Props

| Prop         | Type                                                               | Default     | Description                                                         |
| ------------ | ------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------- |
| `animation`  | `"fade-up" \| "fade-in" \| "fade-left" \| "fade-right" \| "scale"` | `"fade-up"` | Animation type applied when the element becomes visible             |
| `threshold`  | `number`                                                           | `0.1`       | IntersectionObserver threshold (0--1)                               |
| `delay`      | `number`                                                           | `0`         | Additional delay in milliseconds before animation starts            |
| `once`       | `boolean`                                                          | `true`      | Animate only on first intersection (`true`) or every time (`false`) |
| `rootMargin` | `string`                                                           | `"0px"`     | IntersectionObserver root margin (e.g. `"-50px"` to trigger early)  |
| `as`         | `ElementType`                                                      | `"div"`     | Polymorphic element type                                            |
| `className`  | `string`                                                           | --          | Additional CSS classes                                              |
| `children`   | `ReactNode`                                                        | --          | Content to reveal                                                   |

Also accepts all props of the underlying element type.

### Behavior

- Before the element enters the viewport, it has the class `scroll-reveal-hidden` (making it invisible).
- When the IntersectionObserver fires, the `scroll-reveal-hidden` class is removed and the animation class (e.g., `fade-up`) is added.
- If `delay > 0`, it is applied via inline `animationDelay` and `animationFillMode: "backwards"`.
- If `once` is `true` (default), the observer disconnects after the first intersection.
- If `once` is `false`, the element re-hides when it scrolls out and re-animates on re-entry.
- Uses `--MOTION-DURATION-ENTER` and `--MOTION-EASE-ENTER` for animation timing.
- **Reduced motion:** Element appears immediately with no animation.

### Animation Class Map

| `animation` Prop | CSS Class Applied |
| ---------------- | ----------------- |
| `"fade-up"`      | `fade-up`         |
| `"fade-in"`      | `fade-in`         |
| `"fade-left"`    | `fade-left`       |
| `"fade-right"`   | `fade-right`      |
| `"scale"`        | `scale-in`        |

### Usage

```tsx
import { ScrollReveal } from "@/web/components/animation/ScrollReveal";

{
  /* Default fade-up on scroll */
}
<ScrollReveal>
  <h2>This heading fades up into view</h2>
</ScrollReveal>;

{
  /* Fade in from the right */
}
<ScrollReveal animation="fade-right">
  <p>Slides in from the right</p>
</ScrollReveal>;

{
  /* Scale up with a delay */
}
<ScrollReveal animation="scale" delay={200}>
  <div>Pops in after 200ms</div>
</ScrollReveal>;

{
  /* Re-animate every time it enters the viewport */
}
<ScrollReveal once={false} animation="fade-in">
  <div>Fades in every time you scroll past</div>
</ScrollReveal>;

{
  /* Trigger earlier with negative rootMargin */
}
<ScrollReveal rootMargin="-100px" threshold={0.2}>
  <div>Triggers 100px before entering the viewport</div>
</ScrollReveal>;

{
  /* Use a semantic element */
}
<ScrollReveal as="section" animation="fade-up">
  <h3>Section content</h3>
</ScrollReveal>;
```

---

## Stagger

Wraps a list of children and applies incremental animation delays for cascading entrance effects. Each child is wrapped in a `div.stagger-item` with a `--stagger-index` CSS custom property.

**Source:** `src/web/components/animation/Stagger.tsx`

### Props

| Prop           | Type          | Default                         | Description                                |
| -------------- | ------------- | ------------------------------- | ------------------------------------------ |
| `staggerDelay` | `string`      | `--MOTION-STAGGER-DELAY` (50ms) | Delay increment per child (CSS time value) |
| `as`           | `ElementType` | `"div"`                         | Polymorphic element type for the wrapper   |
| `className`    | `string`      | --                              | Additional CSS classes on the wrapper      |
| `children`     | `ReactNode`   | --                              | Items to stagger                           |

Also accepts all props of the underlying element type.

### Behavior

- Each child is wrapped in a `<div class="stagger-item">` with `style="--stagger-index: N"` where N is the zero-based index.
- CSS uses `calc(var(--stagger-index) * var(--MOTION-STAGGER-DELAY))` for `animation-delay`.
- If a custom `staggerDelay` is provided, it is set as `--stagger-delay` on the wrapper element.
- **Reduced motion:** All `--stagger-index` values are set to `0`, making all children appear simultaneously.
- Composes with `ScrollReveal` -- the stagger triggers when the container enters the viewport.

### Usage

```tsx
import { Stagger } from "@/web/components/animation/Stagger";

{
  /* Basic staggered list */
}
<Stagger>
  <div>Item 1 (appears first)</div>
  <div>Item 2 (appears second)</div>
  <div>Item 3 (appears third)</div>
</Stagger>;

{
  /* Custom stagger delay */
}
<Stagger staggerDelay="100ms">
  <p>Slower cascade -- 100ms between each item</p>
  <p>Second item</p>
  <p>Third item</p>
</Stagger>;

{
  /* Composed with ScrollReveal */
}
<ScrollReveal>
  <Stagger>
    <div>Cascades in when scrolled into view</div>
    <div>Second item</div>
    <div>Third item</div>
  </Stagger>
</ScrollReveal>;
```

---

## AnimatePresence

Mount/unmount animation wrapper. Ensures exit animations play before DOM removal.

**Source:** `src/web/components/animation/AnimatePresence.tsx`

### Props

| Prop         | Type        | Default      | Description                                   |
| ------------ | ----------- | ------------ | --------------------------------------------- |
| `show`       | `boolean`   | _required_   | Whether the children should be mounted        |
| `enterClass` | `string`    | `"fade-in"`  | CSS animation class applied on mount (enter)  |
| `exitClass`  | `string`    | `"fade-out"` | CSS animation class applied on unmount (exit) |
| `className`  | `string`    | --           | Additional CSS classes on the wrapper div     |
| `children`   | `ReactNode` | _required_   | Content to animate in/out                     |

Also accepts all `div` props.

### Behavior

1. When `show` transitions from `false` to `true`: the component mounts its children and applies the `enterClass`.
2. When `show` transitions from `true` to `false`: the `exitClass` is applied and the component listens for `onAnimationEnd` before removing the children from the DOM.
3. Uses `--MOTION-DURATION-EXIT` and `--MOTION-EASE-EXIT` for exit animation timing.
4. **Reduced motion:** On unmount, children are removed immediately with no exit animation.

### Usage

```tsx
import { AnimatePresence } from "@/web/components/animation/AnimatePresence";

{
  /* Basic fade toggle */
}
<AnimatePresence show={isVisible}>
  <div className="p-r3 bg-surface-0 rounded-lg shadow-md">This content fades in and out.</div>
</AnimatePresence>;

{
  /* Custom enter/exit animations */
}
<AnimatePresence show={isOpen} enterClass="fade-up" exitClass="fade-out">
  <div>Slides up on enter, fades out on exit.</div>
</AnimatePresence>;

{
  /* Notification toast */
}
<AnimatePresence show={showToast} enterClass="fade-right" exitClass="fade-left">
  <div className="fixed top-4 right-4 bg-surface-0 shadow-lg rounded-md p-r3">{toastMessage}</div>
</AnimatePresence>;
```

---

## ViewTransition

Wrapper that hooks into the browser's View Transitions API for cross-page shared element transitions. Also exports a `useViewTransition()` hook for triggering view-transition-aware navigation.

**Source:** `src/web/components/animation/ViewTransition.tsx`

### ViewTransition Component Props

| Prop        | Type            | Default    | Description                                            |
| ----------- | --------------- | ---------- | ------------------------------------------------------ |
| `name`      | `string`        | _required_ | The `view-transition-name` CSS property value          |
| `className` | `string`        | --         | Additional CSS classes on the wrapper div              |
| `style`     | `CSSProperties` | --         | Additional inline styles (merged with transition name) |
| `children`  | `ReactNode`     | _required_ | Content that participates in the view transition       |

Also accepts all `div` props.

### useViewTransition Hook

```tsx
const navigate = useViewTransition();
navigate("/target-route");
navigate("/target-route", { replace: true });
```

Returns a function with the same signature as React Router's `navigate`. When called:

- If `document.startViewTransition` is available: wraps the navigation in `document.startViewTransition()`.
- If unsupported: falls back to standard `navigate()`.

### Behavior

- The component renders a `<div>` with `style={{ viewTransitionName: name }}`.
- When two pages both have a `ViewTransition` with the same `name`, the browser morphs between them during the transition.
- Companion CSS file (`style/animations/view-transitions.css`) provides default `::view-transition-*` pseudo-element styles using `--MOTION-*` tokens.
- **Graceful fallback:** If the browser does not support `document.startViewTransition`, navigation proceeds normally with no errors.

### Usage

```tsx
import { ViewTransition, useViewTransition } from "@/web/components/animation/ViewTransition";

{
  /* On a list page -- assign a unique transition name per card */
}
function CardList({ items }) {
  const navigate = useViewTransition();

  return (
    <div>
      {items.map((item) => (
        <ViewTransition key={item.id} name={`card-${item.id}`}>
          <div onClick={() => navigate(`/items/${item.id}`)}>
            <img src={item.image} alt={item.title} />
            <h3>{item.title}</h3>
          </div>
        </ViewTransition>
      ))}
    </div>
  );
}

{
  /* On the detail page -- use the same transition name */
}
function CardDetail({ item }) {
  return (
    <ViewTransition name={`card-${item.id}`}>
      <div>
        <img src={item.image} alt={item.title} />
        <h1>{item.title}</h1>
        <p>{item.description}</p>
      </div>
    </ViewTransition>
  );
}
```

---

## Parallax

Scroll-linked transform that moves children at a different rate than the scroll for a depth/parallax effect. Uses `requestAnimationFrame` for smooth 60fps updates.

**Source:** `src/web/components/animation/Parallax.tsx`

### Props

| Prop        | Type            | Default                          | Description                                          |
| ----------- | --------------- | -------------------------------- | ---------------------------------------------------- |
| `rate`      | `number`        | `0.3` (`--MOTION-PARALLAX-RATE`) | Speed ratio: 0 = fixed, 1 = normal scroll speed      |
| `clamp`     | `number`        | --                               | Max pixel offset to prevent extreme movement         |
| `className` | `string`        | --                               | Additional CSS classes                               |
| `style`     | `CSSProperties` | --                               | Additional inline styles (merged with `will-change`) |
| `children`  | `ReactNode`     | _required_                       | Content to parallax                                  |

Also accepts all `div` props.

### Behavior

1. On every scroll event, the component calculates the distance between the element's center and the viewport center.
2. The offset is `distance * rate`, applied as `translateY(offset)`.
3. If `clamp` is provided, the offset is clamped to `[-clamp, clamp]` pixels.
4. `will-change: transform` is applied for GPU compositing.
5. Uses `requestAnimationFrame` to debounce scroll updates.
6. The scroll listener uses `{ passive: true }` for performance.
7. **Reduced motion:** The parallax effect is completely disabled. No transform is applied and `will-change` is removed.

### Usage

```tsx
import { Parallax } from "@/web/components/animation/Parallax";

{
  /* Slow-moving background for depth */
}
<Parallax rate={0.2}>
  <img src="/hero-bg.jpg" alt="" className="w-full h-full object-cover" />
</Parallax>;

{
  /* Faster parallax with clamping */
}
<Parallax rate={0.5} clamp={100}>
  <div className="text-h1">Big Heading</div>
</Parallax>;

{
  /* Subtle float effect */
}
<Parallax rate={0.1}>
  <div className="bg-surface-0 rounded-lg shadow-md p-r3">
    This card drifts slightly as you scroll.
  </div>
</Parallax>;

{
  /* Fixed element (rate=0) */
}
<Parallax rate={0}>
  <div>This element does not move with scroll at all.</div>
</Parallax>;
```

---

## Composition Examples

### Staggered Scroll Reveal List

A list of cards that cascade into view as the user scrolls:

```tsx
import { ScrollReveal } from "@/web/components/animation/ScrollReveal";
import { Stagger } from "@/web/components/animation/Stagger";
import { Stack } from "@/web/components/layout/Stack";

function FeatureList({ features }) {
  return (
    <ScrollReveal animation="fade-up">
      <Stagger>
        <Stack gap="r4">
          {features.map((feature) => (
            <div key={feature.id} className="bg-surface-0 rounded-lg shadow-sm p-r3">
              <h3 className="text-h5 font-semibold">{feature.title}</h3>
              <p className="text-body-2 text-text-secondary">{feature.description}</p>
            </div>
          ))}
        </Stack>
      </Stagger>
    </ScrollReveal>
  );
}
```

### Animated Page with Parallax Hero

A landing page combining `Parallax`, `ScrollReveal`, and `Stagger`:

```tsx
import { Parallax } from "@/web/components/animation/Parallax";
import { ScrollReveal } from "@/web/components/animation/ScrollReveal";
import { Stagger } from "@/web/components/animation/Stagger";
import { Stack } from "@/web/components/layout/Stack";
import { Container } from "@/web/components/layout/Container";
import { Row } from "@/web/components/layout/Row";

function LandingPage() {
  return (
      <Stack>
        {/* Hero with parallax background */}
        <div className="relative min-h-[80vh] flex items-end overflow-hidden">
          <Parallax rate={0.3} className="absolute inset-0">
            <img src="/hero-bg.jpg" alt="" className="w-full h-full object-cover" />
          </Parallax>

          {/* Overlay */}
          <div className="absolute inset-0 bg-linear-to-t from-black/70 to-transparent" />

          {/* Hero content with stagger */}
          <Container size="lg" className="relative z-10 pb-r1">
            <ScrollReveal animation="fade-up">
              <Stagger>
                <h1 className="text-h1 text-text-inverse">Build Something Great</h1>
                <p className="text-body-1 text-text-inverse">
                  The platform that scales with your ambition.
                </p>
                <Row gap="r4">
                  <button className="btn-primary">Get Started</button>
                  <button className="btn-secondary">Learn More</button>
                </Row>
              </Stagger>
            </ScrollReveal>
          </Container>
        </div>

        {/* Features section with scroll reveals */}
        <Container size="xl" className="py-r1">
          <Stack gap="r2">
            <ScrollReveal animation="fade-up">
              <h2 className="text-h2 text-center">Why Choose Us</h2>
            </ScrollReveal>

            <ScrollReveal animation="fade-up">
              <Stagger staggerDelay="75ms">
                <Row gap="r3" wrap>
                  <div className="flex-1 min-w-70 bg-surface-0 rounded-lg shadow-sm p-r3">
                    <h3 className="text-h5">Fast</h3>
                    <p className="text-body-2 text-text-secondary">Deployed to the edge.</p>
                  </div>
                  <div className="flex-1 min-w-70 bg-surface-0 rounded-lg shadow-sm p-r3">
                    <h3 className="text-h5">Reliable</h3>
                    <p className="text-body-2 text-text-secondary">99.9% uptime guaranteed.</p>
                  </div>
                  <div className="flex-1 min-w-70 bg-surface-0 rounded-lg shadow-sm p-r3">
                    <h3 className="text-h5">Scalable</h3>
                    <p className="text-body-2 text-text-secondary">From prototype to production.</p>
                  </div>
                </Row>
              </Stagger>
            </ScrollReveal>
          </Stack>
        </Container>

        {/* Alternating feature sections */}
        <Container size="lg" className="py-r1">
          <ScrollReveal animation="fade-right">
            <Row gap="r2" className="flex-col md:flex-row">
              <Parallax rate={0.1} className="flex-1">
                <img src="/feature-1.jpg" alt="" className="rounded-lg" />
              </Parallax>
              <div className="flex-1">
                <h3 className="text-h3">Lightning Fast</h3>
                <p className="text-body-1 text-text-secondary">Milliseconds from your users.</p>
              </div>
            </Row>
          </ScrollReveal>

          <ScrollReveal animation="fade-left">
            <Row gap="r2" className="flex-col md:flex-row-reverse">
              <Parallax rate={0.1} className="flex-1">
                <img src="/feature-2.jpg" alt="" className="rounded-lg" />
              </Parallax>
              <div className="flex-1">
                <h3 className="text-h3">Built to Scale</h3>
                <p className="text-body-1 text-text-secondary">No code changes needed.</p>
              </div>
            </Row>
          </ScrollReveal>
        </Container>
      </Stack>
  );
}
```

### Animated Modal with AnimatePresence

```tsx
import { AnimatePresence } from "@/web/components/animation/AnimatePresence";

function Modal({ isOpen, onClose, children }) {
  return (
    <>
      {/* Backdrop */}
      <AnimatePresence show={isOpen} enterClass="fade-in" exitClass="fade-out">
        <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence show={isOpen} enterClass="fade-up" exitClass="fade-out">
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-surface-0 rounded-lg shadow-lg p-r2 max-w-lg w-full pointer-events-auto">
            {children}
          </div>
        </div>
      </AnimatePresence>
    </>
  );
}
```

### View Transition Card Grid

Shared element transitions between a list view and detail view:

```tsx
import { ViewTransition, useViewTransition } from "@/web/components/animation/ViewTransition";

function ProductGrid({ products }) {
  const navigate = useViewTransition();

  return (
    <div className="grid grid-cols-3 gap-r3">
      {products.map((product) => (
        <ViewTransition key={product.id} name={`product-${product.id}`}>
          <div
            className="cursor-pointer bg-surface-0 rounded-lg shadow-sm overflow-hidden"
            onClick={() => navigate(`/products/${product.id}`)}
          >
            <img src={product.image} alt={product.name} />
            <div className="p-r4">
              <h3 className="text-h6">{product.name}</h3>
              <p className="text-body-2 text-text-secondary">{product.price}</p>
            </div>
          </div>
        </ViewTransition>
      ))}
    </div>
  );
}

function ProductDetail({ product }) {
  return (
    <ViewTransition name={`product-${product.id}`}>
      <div className="max-w-2xl mx-auto">
        <img src={product.image} alt={product.name} className="w-full rounded-lg" />
        <h1 className="text-h3 mt-r3">{product.name}</h1>
        <p className="text-body-1 text-text-secondary mt-r4">{product.description}</p>
      </div>
    </ViewTransition>
  );
}
```

---

## Motion Token Reference

All animation components use design system motion tokens. Override these CSS custom properties to change the feel globally:

### Durations

| Token                     | Default | Purpose                         |
| ------------------------- | ------- | ------------------------------- |
| `--MOTION-DURATION-ENTER` | 300ms   | Mount/entrance animations       |
| `--MOTION-DURATION-EXIT`  | 200ms   | Unmount/exit animations         |
| `--MOTION-DURATION-SHIFT` | 400ms   | Layout shift / morph animations |
| `--MOTION-DURATION-PAGE`  | 350ms   | Cross-page transitions          |

### Easing

| Token                  | Default                             | Purpose                      |
| ---------------------- | ----------------------------------- | ---------------------------- |
| `--MOTION-EASE-ENTER`  | `cubic-bezier(0.22, 1, 0.36, 1)`    | Entrance easing (decelerate) |
| `--MOTION-EASE-EXIT`   | `cubic-bezier(0.55, 0, 1, 0.45)`    | Exit easing (accelerate)     |
| `--MOTION-EASE-SHIFT`  | `cubic-bezier(0.33, 1, 0.68, 1)`    | Layout shift easing          |
| `--MOTION-EASE-BOUNCE` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful overshoot            |

### Distances and Delays

| Token                    | Default | Purpose                           |
| ------------------------ | ------- | --------------------------------- |
| `--MOTION-DISTANCE-SM`   | 8px     | Small translate offset            |
| `--MOTION-DISTANCE-MD`   | 20px    | Medium translate offset           |
| `--MOTION-DISTANCE-LG`   | 40px    | Large translate offset            |
| `--MOTION-STAGGER-DELAY` | 50ms    | Per-item delay in staggered lists |
| `--MOTION-PARALLAX-RATE` | 0.3     | Default parallax speed ratio      |
