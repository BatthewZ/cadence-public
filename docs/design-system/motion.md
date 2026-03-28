# Motion Tokens

**File:** `src/web/style/tokens/motion.css`

Animation and transition tuning knobs that control the **feel** of all motion across the system. Swap these values to go from snappy tech to heavy cinematic.

### Durations

| CSS Variable              | Default Value | Tailwind Class          | Purpose                         |
| ------------------------- | ------------- | ----------------------- | ------------------------------- |
| `--MOTION-DURATION-ENTER` | `300ms`       | `duration-motion-enter` | Mount/entrance animations       |
| `--MOTION-DURATION-EXIT`  | `200ms`       | `duration-motion-exit`  | Unmount/exit animations         |
| `--MOTION-DURATION-SHIFT` | `400ms`       | `duration-motion-shift` | Layout shift / morph animations |
| `--MOTION-DURATION-PAGE`  | `350ms`       | `duration-motion-page`  | Cross-page transitions          |

### Easing

| CSS Variable             | Default Value                        | Purpose                      |
| ------------------------ | ------------------------------------ | ---------------------------- |
| `--MOTION-EASE-ENTER`   | `cubic-bezier(0.22, 1, 0.36, 1)`    | Entrance easing (decelerate) |
| `--MOTION-EASE-EXIT`    | `cubic-bezier(0.55, 0, 1, 0.45)`    | Exit easing (accelerate)     |
| `--MOTION-EASE-SHIFT`   | `cubic-bezier(0.33, 1, 0.68, 1)`    | Layout shift easing          |
| `--MOTION-EASE-BOUNCE`  | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful overshoot            |

### Distances and Scale

| CSS Variable               | Default Value | Purpose                           |
| -------------------------- | ------------- | --------------------------------- |
| `--MOTION-DISTANCE-SM`     | `8px`         | Small translate offset            |
| `--MOTION-DISTANCE-MD`     | `20px`        | Medium translate offset           |
| `--MOTION-DISTANCE-LG`     | `40px`        | Large translate offset            |
| `--MOTION-STAGGER-DELAY`   | `50ms`        | Per-item delay in staggered lists |
| `--MOTION-PARALLAX-RATE`   | `0.3`         | Default parallax speed ratio      |
| `--MOTION-SCALE-HOVER`     | `1.05`        | Hover scale-up factor             |
| `--MOTION-SCALE-PRESS`     | `0.97`        | Press scale-down factor           |
