import { type FormEvent, useMemo, useState } from "react";

import { Field, Input, Label, Radio, Select } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import { Alert, Button, Dialog, Text } from "@/web/components/ui";
import type { WorkspaceProjectSummary } from "@/web/hooks/use-workspace-projects";

import { ProjectMultiSelect } from "./ProjectMultiSelect";
import { RevealTokenPanel } from "./RevealTokenPanel";
import { ScopeSelector } from "./ScopeSelector";
import type { ExpiryOption, ProjectScopeMode } from "./types";

/* ------------------------------------------------------------------ */
/*  CreateApiTokenDialog                                               */
/*                                                                     */
/*  Two-phase dialog: form input -> server roundtrip -> reveal panel.  */
/*  The reveal phase swaps the entire dialog body so users cannot      */
/*  accidentally re-submit while the plaintext is on screen.           */
/*                                                                     */
/*  Form state lives in <CreateApiTokenForm /> (a child component)     */
/*  with its initial values seeded from defaults. The wrapper bumps a  */
/*  `key` whenever the dialog re-opens, forcing React to remount the   */
/*  form and reset all fields without an effect-driven state cascade.  */
/* ------------------------------------------------------------------ */

export interface CreateApiTokenInput {
  name: string;
  scopes: string[];
  projectScope: ProjectScopeMode;
  projectIds?: string[];
  expiresInDays: number | null;
}

interface CreateApiTokenDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateApiTokenInput) => Promise<void>;
  isPending: boolean;
  errorMessage: string | undefined;
  /** Plaintext returned by the create mutation; switches view to reveal. */
  plaintext: string | null;
  projects: WorkspaceProjectSummary[];
  projectsLoading: boolean;
  /** Called when the user dismisses the reveal panel. */
  onRevealDismissed: () => void;
}

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "365 days (1 year)" },
  { value: "never", label: "Never (not recommended)" },
];

export function CreateApiTokenDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  errorMessage,
  plaintext,
  projects,
  projectsLoading,
  onRevealDismissed,
}: CreateApiTokenDialogProps) {
  // Each time the dialog transitions from closed -> open we bump openCount so
  // the inner <CreateApiTokenForm /> remounts (and discards any stale state)
  // without an effect-driven cascade of setState calls. Plaintext presence
  // shifts the body to the reveal panel, where remount is not needed.
  //
  // We compute the count via an inline derived state pattern: useState's
  // initializer fires only on first mount, and we use the setter-with-fn form
  // inside the open transition check to obtain a fresh count without breaking
  // the rules of hooks (setState during render is allowed when guarded by an
  // equality check, per React docs on "Storing information from previous
  // renders").
  const [openCount, setOpenCount] = useState(0);
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setOpenCount((n) => n + 1);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        // While the reveal panel is showing the only valid exit is "Done"
        // (gated by the acknowledgement checkbox). Blocking the dialog's own
        // close path here prevents reflex Escape / backdrop clicks from
        // discarding the unrecoverable plaintext.
        if (!plaintext) onClose();
      }}
      className="max-w-2xl"
    >
      {plaintext ? (
        <RevealTokenPanel
          heading="API Token Created"
          banner="Add this token to your integration's environment as the Authorization: Bearer header."
          plaintext={plaintext}
          onDone={onRevealDismissed}
        />
      ) : (
        <CreateApiTokenForm
          key={openCount}
          onClose={onClose}
          onSubmit={onSubmit}
          isPending={isPending}
          errorMessage={errorMessage}
          projects={projects}
          projectsLoading={projectsLoading}
        />
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  CreateApiTokenForm                                                 */
/* ------------------------------------------------------------------ */

interface CreateApiTokenFormProps {
  onClose: () => void;
  onSubmit: (input: CreateApiTokenInput) => Promise<void>;
  isPending: boolean;
  errorMessage: string | undefined;
  projects: WorkspaceProjectSummary[];
  projectsLoading: boolean;
}

function CreateApiTokenForm({
  onClose,
  onSubmit,
  isPending,
  errorMessage,
  projects,
  projectsLoading,
}: CreateApiTokenFormProps) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [projectScope, setProjectScope] = useState<ProjectScopeMode>("all");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ExpiryOption>(365);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const validationError = useMemo(() => {
    if (!name.trim()) return "Name is required.";
    if (name.trim().length > 100) return "Name must be 100 characters or fewer.";
    if (scopes.length === 0) return "Select at least one scope.";
    if (projectScope === "selected" && projectIds.length === 0) {
      return "Select at least one project, or choose 'All projects'.";
    }
    return null;
  }, [name, scopes, projectScope, projectIds]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (validationError) return;

    const input: CreateApiTokenInput = {
      name: name.trim(),
      scopes,
      projectScope,
      projectIds: projectScope === "selected" ? projectIds : undefined,
      expiresInDays: expiry === "never" ? null : expiry,
    };
    try {
      await onSubmit(input);
    } catch {
      // The mutation owns error state; errorMessage prop renders the message.
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <Stack gap="r4">
        <Stack gap="r6">
          <Text variant="h5" weight="semibold">
            New API Token
          </Text>
          <Text variant="body-3" color="muted">
            Generate a Personal Access Token for integrating Cadence with Slack
            bots, GitHub Actions, or your own tools.
          </Text>
        </Stack>

        <Field>
          <Label htmlFor="api-token-name">Name</Label>
          <Input
            id="api-token-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Slack release bot"
            maxLength={100}
            required
            autoFocus
          />
          <Text variant="body-3" color="muted">
            A descriptive label so you can identify this token later.
          </Text>
        </Field>

        <Field>
          <Label>Scopes</Label>
          <ScopeSelector value={scopes} onChange={setScopes} />
        </Field>

        <Field>
          <Label>Project access</Label>
          <Stack gap="r5">
            <label className="flex items-start gap-r5 cursor-pointer">
              <Radio
                name="project-scope"
                value="all"
                checked={projectScope === "all"}
                onChange={() => setProjectScope("all")}
                className="mt-r6"
              />
              <Stack gap="r6">
                <Text variant="body-2" weight="semibold" as="span">
                  All projects in this workspace
                </Text>
                <Text variant="body-3" color="muted" as="span">
                  Token can access every project the owning user can see.
                </Text>
              </Stack>
            </label>
            <label className="flex items-start gap-r5 cursor-pointer">
              <Radio
                name="project-scope"
                value="selected"
                checked={projectScope === "selected"}
                onChange={() => setProjectScope("selected")}
                className="mt-r6"
              />
              <Stack gap="r6">
                <Text variant="body-2" weight="semibold" as="span">
                  Selected projects
                </Text>
                <Text variant="body-3" color="muted" as="span">
                  Restrict this token to specific projects (max 50).
                </Text>
              </Stack>
            </label>

            {projectScope === "selected" && (
              <div className="pl-r2">
                <ProjectMultiSelect
                  projects={projects}
                  selectedIds={projectIds}
                  onChange={setProjectIds}
                  loading={projectsLoading}
                />
              </div>
            )}
          </Stack>
        </Field>

        <Field>
          <Label htmlFor="api-token-expiry">Expiry</Label>
          <Select
            id="api-token-expiry"
            value={String(expiry)}
            onChange={(e) => {
              const v = e.target.value;
              setExpiry(v === "never" ? "never" : (Number(v) as 30 | 90 | 365));
            }}
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Text variant="body-3" color="muted">
            Long-lived tokens increase blast radius if leaked. Rotate regularly.
          </Text>
        </Field>

        {submitAttempted && validationError && (
          <Alert variant="error">{validationError}</Alert>
        )}
        {errorMessage && <Alert variant="error">{errorMessage}</Alert>}

        <Row gap="r4" justify="end" className="pt-r3">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={isPending}>
            {isPending ? "Generating..." : "Generate Token"}
          </Button>
        </Row>
      </Stack>
    </form>
  );
}
