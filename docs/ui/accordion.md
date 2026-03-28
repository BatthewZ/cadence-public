# Accordion

Expand/collapse sections with smooth height animation using a CSS `grid-template-rows` transition. Supports single-open and multiple-open modes with full keyboard navigation.

**Source:** `src/web/components/ui/Accordion.tsx`
**Styles:** `src/web/style/components/accordion.css`

## Compound API

| Component            | Element    | Purpose                                          |
| -------------------- | ---------- | ------------------------------------------------ |
| `Accordion`          | `<div>`    | Root provider. Manages which items are open.      |
| `Accordion.Item`     | `<div>`    | Wraps a single collapsible section.               |
| `Accordion.Trigger`  | `<button>` | Clickable header that toggles the section.        |
| `Accordion.Content`  | `<div>`    | Collapsible content region with height animation. |

## Props

### Accordion (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `"single" \| "multiple"` | `"single"` | `single` closes other items when one opens. `multiple` allows any number open. |
| `defaultValue` | `string \| string[]` | -- | Initially open item(s) (uncontrolled). |
| `value` | `string \| string[]` | -- | Open item(s) (controlled mode). |
| `onValueChange` | `(value: string \| string[]) => void` | -- | Callback when open state changes. In single mode receives a `string`, in multiple mode receives `string[]`. |
| `className` | `string` | -- | Additional CSS classes on the root `<div>`. |

### Accordion.Item

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | **required** | Unique key identifying this item. |
| `disabled` | `boolean` | `false` | Prevents this item from being toggled. |
| `className` | `string` | -- | Additional CSS classes. |

### Accordion.Trigger

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the trigger button. |

Renders a chevron icon that rotates 180 degrees when the item is open.

### Accordion.Content

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the content wrapper. |

## Animation

Content height animates via CSS `grid-template-rows: 0fr` to `1fr` transition, using `--MOTION-DURATION-SHIFT` and `--MOTION-EASE-SHIFT` tokens. The chevron icon rotation uses the same timing. Both transitions are disabled when `prefers-reduced-motion: reduce` is active.

## Keyboard Navigation

| Key | Behavior |
| --- | --- |
| `ArrowDown` | Move focus to the next trigger (wraps). |
| `ArrowUp` | Move focus to the previous trigger (wraps). |
| `Home` | Move focus to the first trigger. |
| `End` | Move focus to the last trigger. |
| `Enter` / `Space` | Toggle the focused item (native button behavior). |

## Accessibility

- `aria-expanded` on each trigger reflects open/closed state.
- `aria-controls` links each trigger to its content region.
- Content has `role="region"` with `aria-labelledby` pointing to its trigger.
- `data-state="open"` / `data-state="closed"` on both `Accordion.Item` and `Accordion.Content` for CSS targeting.
- `data-disabled` attribute set on disabled items.

## Usage

### FAQ Pattern (Single Mode)

```tsx
import { Accordion } from "@/web/components/ui/Accordion";

<Accordion mode="single" defaultValue="q1">
  <Accordion.Item value="q1">
    <Accordion.Trigger>What payment methods do you accept?</Accordion.Trigger>
    <Accordion.Content>
      <p>We accept all major credit cards, PayPal, and bank transfers.</p>
    </Accordion.Content>
  </Accordion.Item>

  <Accordion.Item value="q2">
    <Accordion.Trigger>Can I cancel my subscription?</Accordion.Trigger>
    <Accordion.Content>
      <p>Yes, you can cancel anytime from your account settings.</p>
    </Accordion.Content>
  </Accordion.Item>

  <Accordion.Item value="q3">
    <Accordion.Trigger>Do you offer refunds?</Accordion.Trigger>
    <Accordion.Content>
      <p>We offer a 30-day money-back guarantee on all plans.</p>
    </Accordion.Content>
  </Accordion.Item>
</Accordion>
```

### Multiple Mode

```tsx
<Accordion mode="multiple" defaultValue={["details", "shipping"]}>
  <Accordion.Item value="details">
    <Accordion.Trigger>Product Details</Accordion.Trigger>
    <Accordion.Content>
      <p>Full product specifications and features.</p>
    </Accordion.Content>
  </Accordion.Item>

  <Accordion.Item value="shipping">
    <Accordion.Trigger>Shipping Information</Accordion.Trigger>
    <Accordion.Content>
      <p>Free shipping on orders over $50.</p>
    </Accordion.Content>
  </Accordion.Item>

  <Accordion.Item value="returns">
    <Accordion.Trigger>Returns & Exchanges</Accordion.Trigger>
    <Accordion.Content>
      <p>Easy returns within 30 days of purchase.</p>
    </Accordion.Content>
  </Accordion.Item>
</Accordion>
```

### Controlled Usage

```tsx
import { useState } from "react";
import { Accordion } from "@/web/components/ui/Accordion";

function ControlledAccordion() {
  const [openItem, setOpenItem] = useState<string>("");

  return (
    <Accordion mode="single" value={openItem} onValueChange={setOpenItem}>
      <Accordion.Item value="section1">
        <Accordion.Trigger>Section 1</Accordion.Trigger>
        <Accordion.Content>
          <p>Content for section 1.</p>
        </Accordion.Content>
      </Accordion.Item>

      <Accordion.Item value="section2">
        <Accordion.Trigger>Section 2</Accordion.Trigger>
        <Accordion.Content>
          <p>Content for section 2.</p>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
}
```

### With Disabled Item

```tsx
<Accordion mode="single">
  <Accordion.Item value="open">
    <Accordion.Trigger>Available Section</Accordion.Trigger>
    <Accordion.Content>
      <p>This section can be toggled.</p>
    </Accordion.Content>
  </Accordion.Item>

  <Accordion.Item value="locked" disabled>
    <Accordion.Trigger>Locked Section</Accordion.Trigger>
    <Accordion.Content>
      <p>This content is locked.</p>
    </Accordion.Content>
  </Accordion.Item>
</Accordion>
```
