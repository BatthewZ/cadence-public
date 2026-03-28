import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useState } from "react";

import { createWorkspaceSchema } from "@/shared/schemas/workspace";
import { Field, FieldError, FormActions, Input, Label, Textarea } from "@/web/components/form";
import { Stack } from "@/web/components/layout";
import {
  Alert,
  Button,
  Dialog,
  Text,
} from "@/web/components/ui";
import { type Workspace } from "@/web/contexts/WorkspaceContext";
import { useFieldErrors } from "@/web/hooks/use-field-errors";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

import { slugify } from "./helpers";

interface CreateWorkspaceResponse {
  workspace: Workspace;
}

interface CreateWorkspaceBody {
  name: string;
  slug: string;
  description?: string;
}

export function CreateWorkspaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const { fieldErrors, clearFieldError, setFromZodError, resetFieldErrors } = useFieldErrors();

  const qc = useQueryClient();
  const { mutateAsync, isPending: loading, error: mutationError, reset } = useMutation({
    mutationFn: (input: CreateWorkspaceBody) =>
      api.post<CreateWorkspaceResponse>("/api/workspaces", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
  const error = mutationError?.message ?? null;

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (!slugTouched) {
        setSlug(slugify(value));
      }
    },
    [slugTouched]
  );

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(slugify(value));
  }

  function resetForm() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
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

    const validation = createWorkspaceSchema.safeParse({
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || undefined,
    });
    if (!validation.success) {
      setFromZodError(validation.error);
      return;
    }

    try {
      const result = await mutateAsync(validation.data);
      resetForm();
      onCreated(result.workspace.slug);
    } catch {
      // error is set via useMutation state
    }
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <Stack gap="r4">
          <Text variant="h4">Create Workspace</Text>

          <Field>
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              type="text"
              placeholder="My Workspace"
              value={name}
              onChange={(e) => {
                handleNameChange(e.target.value);
                clearFieldError("name");
              }}
              error={!!fieldErrors.name}
              autoFocus
            />
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>

          <Field>
            <Label htmlFor="ws-slug">URL</Label>
            <Input
              id="ws-slug"
              type="text"
              placeholder="my-workspace"
              value={slug}
              onChange={(e) => {
                handleSlugChange(e.target.value);
                clearFieldError("slug");
              }}
              error={!!fieldErrors.slug}
            />
            <FieldError>{fieldErrors.slug}</FieldError>
            {slug && (
              <Text variant="body-3" color="secondary" className="mt-1">
                Your workspace will be at <span className="font-medium text-fg-primary">/w/{slug}</span>
              </Text>
            )}
          </Field>

          <Field>
            <Label htmlFor="ws-description">Description</Label>
            <Textarea
              id="ws-description"
              placeholder="What is this workspace for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>

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
