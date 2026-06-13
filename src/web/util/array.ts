/**
 * XOR-toggles `value` in an array: present → removed, absent → appended; the
 * input is never mutated.
 *
 * This is the toggle semantic shared by every multi-select filter surface
 * (filter popovers, click-to-filter task-card chips, list-view cells). A
 * second click on an already-selected value must *undo* it, not duplicate it
 * into the URL (`assignee=u1,u1`) — which is why this exists instead of a
 * plain `[...values, value]` append. Removal preserves the rest of the array,
 * so a toggle composes with values selected elsewhere (e.g. a card chip and
 * the filter bar both contribute to the same dimension) without clobbering
 * them.
 *
 * Accepts `readonly` arrays so callers can pass frozen or `as const` lists.
 */
export function toggleArrayValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}
