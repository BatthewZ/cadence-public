import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { createProjectSchema } from "@/shared/schemas/project";
import type { Theme } from "@/shared/types/theme";
import { Field, FieldError, FormActions, Input, Label, Textarea } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import { Accordion, Alert, Button, Dialog, Text } from "@/web/components/ui";
import { IconPicker } from "@/web/components/ui/IconPicker";
import { ThemeGrid } from "@/web/components/ui/ThemeGrid";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useFieldErrors } from "@/web/hooks/use-field-errors";
import { useThemePreview } from "@/web/hooks/use-theme";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { THEME_LABELS } from "@/web/lib/theme-constants";

interface CreateProjectResponse {
  project: { id: string };
}

interface CreateProjectBody {
  name: string;
  description?: string;
  icon?: string | null;
  budget?: number | null;
  theme?: string | null;
}

export function CreateProjectDialog({
  workspaceId,
  open,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [theme, setTheme] = useState<Theme | null>(null);
  const { fieldErrors, clearFieldError, setFromZodError, resetFieldErrors } = useFieldErrors();

  const { workspace } = useWorkspace();
  const workspaceTheme = (workspace.theme ?? "default") as Theme;

  useThemePreview(theme, open);

  const qc = useQueryClient();
  const { mutateAsync, isPending: loading, error: mutationError, reset } = useMutation({
    mutationFn: (input: CreateProjectBody) =>
      api.post<CreateProjectResponse>(`/api/workspaces/${workspaceId}/projects`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.projects(workspaceId) });
    },
  });
  const error = mutationError?.message ?? null;

  function resetForm() {
    setName("");
    setDescription("");
    setIcon(null);
    setBudget("");
    setTheme(null);
    resetFieldErrors();
    reset();
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    resetFieldErrors();

    const budgetCents = budget.trim() === ""
      ? null
      : Math.round(parseFloat(budget) * 100);

    if (budgetCents !== null && (isNaN(budgetCents) || budgetCents < 0)) return;

    const validation = createProjectSchema.safeParse({
      name: name.trim(),
      description: description.trim() || undefined,
      icon: icon ?? undefined,
      budget: budgetCents,
      theme: theme,
    });
    if (!validation.success) {
      setFromZodError(validation.error);
      return;
    }

    try {
      const result = await mutateAsync(validation.data);
      resetForm();
      onCreated(result.project.id);
    } catch {
      // error is set via useMutation state
    }
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <Stack gap="r4">
          <Text variant="h4">Create Project</Text>

          <Field>
            <Label htmlFor="proj-name">Name</Label>
            <Input
              id="proj-name"
              type="text"
              placeholder="Project name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearFieldError("name");
              }}
              error={!!fieldErrors.name}
              autoFocus
            />
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>

          <Field>
            <Label>Icon</Label>
            <IconPicker value={icon} onChange={setIcon} compact portal={false} />
          </Field>

          <Field>
            <Label htmlFor="proj-description">Description</Label>
            <Textarea
              id="proj-description"
              placeholder="What is this project about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>

          <Accordion mode="single">
            <Accordion.Item value="options">
              <Accordion.Trigger>Options</Accordion.Trigger>
              <Accordion.Content>
                <Stack gap="r4">
                  <Field>
                    <Label htmlFor="create-proj-budget">Budget</Label>
                    <Row gap="r5" align="center">
                      <Text variant="body-2" color="muted">$</Text>
                      <Input
                        id="create-proj-budget"
                        type="number"
                        min="0"
                        step="0.01"
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                        placeholder="0.00"
                        className="flex-1"
                      />
                    </Row>
                    <Text variant="body-3" color="muted">
                      Set a budget to track spending against task costs. Leave empty for no budget.
                    </Text>
                  </Field>

                  <Field>
                    <Label>Theme</Label>
                    <Text variant="body-3" color="muted" className="mb-r3">
                      {theme
                        ? `Selected: ${THEME_LABELS[theme]}`
                        : `Inherits workspace theme (${THEME_LABELS[workspaceTheme]})`}
                    </Text>
                    <ThemeGrid
                      activeTheme={theme}
                      onSelect={(t) => setTheme(theme === t ? null : t)}
                      highlightedTheme={theme === null ? workspaceTheme : undefined}
                    />
                  </Field>
                </Stack>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion>

          {error && <Alert variant="error">{error}</Alert>}

          <FormActions>
            <Button type="button" variant="ghost" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </FormActions>
        </Stack>
      </form>
    </Dialog>
  );
}
