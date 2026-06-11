import { Checkbox } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import { Badge, Button, Text } from "@/web/components/ui";

import { ALL_KNOWN_SCOPES, ALL_READ_SCOPES, SCOPE_GROUPS } from "./types";

/* ------------------------------------------------------------------ */
/*  ScopeSelector                                                      */
/*                                                                     */
/*  Renders the full scope catalog grouped by resource. Each group has */
/*  an indeterminate "select all in group" header checkbox; the panel  */
/*  also exposes two top-level convenience actions: "Select all reads" */
/*  and "Clear all".                                                   */
/* ------------------------------------------------------------------ */

interface ScopeSelectorProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export function ScopeSelector({ value, onChange }: ScopeSelectorProps) {
  const selected = new Set(value);

  function toggleScope(scope: string) {
    const next = new Set(selected);
    if (next.has(scope)) {
      next.delete(scope);
    } else {
      next.add(scope);
    }
    onChange([...next]);
  }

  function toggleGroup(scopes: readonly string[], allSelected: boolean) {
    const next = new Set(selected);
    if (allSelected) {
      for (const s of scopes) next.delete(s);
    } else {
      for (const s of scopes) next.add(s);
    }
    onChange([...next]);
  }

  function selectAllReads() {
    const next = new Set(selected);
    for (const s of ALL_READ_SCOPES) next.add(s);
    onChange([...next]);
  }

  function clearAll() {
    onChange([]);
  }

  const totalSelected = value.filter((v) => ALL_KNOWN_SCOPES.includes(v)).length;

  return (
    <Stack gap="r4">
      <Row justify="between" align="center" className="flex-wrap gap-r5">
        <Row gap="r5" align="center">
          <Text variant="body-3" color="muted" as="span">
            {totalSelected} {totalSelected === 1 ? "scope" : "scopes"} selected
          </Text>
          {totalSelected === 0 && (
            <Badge variant="warning">At least one required</Badge>
          )}
        </Row>
        <Row gap="r5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectAllReads}
          >
            Select all reads
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            disabled={totalSelected === 0}
          >
            Clear
          </Button>
        </Row>
      </Row>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-r4">
        {SCOPE_GROUPS.map((group) => {
          const scopeValues = group.scopes.map((s) => s.value);
          const allInGroup = scopeValues.every((s) => selected.has(s));
          const someInGroup = scopeValues.some((s) => selected.has(s));

          return (
            <div
              key={group.label}
              className="rounded-lg border border-border-default/50 bg-surface-0 p-r4"
            >
              <label className="flex items-start gap-r5 cursor-pointer mb-r5">
                <Checkbox
                  checked={allInGroup}
                  ref={(el) => {
                    if (el) el.indeterminate = someInGroup && !allInGroup;
                  }}
                  onChange={() => toggleGroup(scopeValues, allInGroup)}
                  aria-label={`Select all ${group.label} scopes`}
                  className="mt-r6"
                />
                <Stack gap="r6">
                  <Text variant="body-2" weight="semibold" as="span">
                    {group.label}
                  </Text>
                  <Text variant="body-3" color="muted" as="span">
                    {group.description}
                  </Text>
                </Stack>
              </label>

              <Stack gap="r6" className="pl-r3">
                {group.scopes.map((scope) => (
                  <label
                    key={scope.value}
                    className="flex items-center gap-r5 cursor-pointer py-r6"
                  >
                    <Checkbox
                      checked={selected.has(scope.value)}
                      onChange={() => toggleScope(scope.value)}
                      aria-label={scope.value}
                    />
                    <Text variant="body-3" as="span" className="flex-1">
                      {scope.label}
                    </Text>
                    <code className="font-mono text-body-3 text-fg-muted">
                      {scope.value}
                    </code>
                  </label>
                ))}
              </Stack>
            </div>
          );
        })}
      </div>
    </Stack>
  );
}
