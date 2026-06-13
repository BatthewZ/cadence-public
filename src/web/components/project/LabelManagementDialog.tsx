import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LABEL_COLORS } from "@/shared/schemas/label";
import { FormActions } from "@/web/components/form";
import { Stack } from "@/web/components/layout";
import { Button } from "@/web/components/ui/Button";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { Dialog } from "@/web/components/ui/Dialog";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import {
  type Label,
  useCreateLabel,
  useDeleteLabel,
  useUpdateLabel,
} from "@/web/hooks/use-labels";

interface LabelManagementDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  labels: Label[];
}

export function LabelManagementDialog({
  open,
  onClose,
  projectId,
  labels,
}: LabelManagementDialogProps) {
  const { toast } = useToast();
  const createLabel = useCreateLabel(projectId);
  const updateLabel = useUpdateLabel(projectId);
  const deleteLabel = useDeleteLabel(projectId);

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(LABEL_COLORS[5]); // default blue
  const [deleteTarget, setDeleteTarget] = useState<Label | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      await createLabel.mutateAsync({ name, color: newColor });
      setNewName("");
      setNewColor(LABEL_COLORS[5]);
      nameInputRef.current?.focus();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create label", { variant: "error" });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteLabel.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete label", { variant: "error" });
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-104">
        <Stack gap="r5">
          <div className="label-mgmt__header">
            <Text variant="h4">Manage Labels</Text>
            <Text variant="body-3" color="muted">
              {labels.length === 0
                ? "No labels yet"
                : `${labels.length} label${labels.length === 1 ? "" : "s"}`}
            </Text>
          </div>

          <div className="label-mgmt__list">
            {labels.map((lbl) => (
              <LabelRow
                key={lbl.id}
                label={lbl}
                onUpdate={updateLabel.mutate}
                onDelete={() => setDeleteTarget(lbl)}
              />
            ))}

            {labels.length === 0 && (
              <Text variant="body-2" color="muted" className="py-r3 text-center">
                Add your first label below.
              </Text>
            )}
          </div>

          <form
            className="label-mgmt__composer"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <ColorPickerButton color={newColor} onChange={setNewColor} />
            <input
              ref={nameInputRef}
              type="text"
              className="label-mgmt__composer-input"
              placeholder="New label name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={30}
            />
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!newName.trim() || createLabel.isPending}
              className="shrink-0"
            >
              <Plus size={14} />
              Add
            </Button>
          </form>

          <FormActions className="pt-r5">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </FormActions>
        </Stack>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        title="Delete label?"
        confirmLabel="Delete"
        confirmingLabel="Deleting..."
        confirming={deleteLabel.isPending}
      >
        {deleteTarget && deleteTarget.taskCount > 0
          ? `This will remove the label "${deleteTarget.name}" from ${deleteTarget.taskCount} task${deleteTarget.taskCount === 1 ? "" : "s"}.`
          : `Are you sure you want to delete "${deleteTarget?.name ?? ""}"?`}
      </ConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Label Row (inline editable)
// ---------------------------------------------------------------------------

function LabelRow({
  label: lbl,
  onUpdate,
  onDelete,
}: {
  label: Label;
  onUpdate: (vars: { labelId: string; name?: string; color?: string }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(lbl.name);

  function commitName() {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== lbl.name) {
      onUpdate({ labelId: lbl.id, name: trimmed });
    } else {
      setEditName(lbl.name);
    }
    setEditing(false);
  }

  return (
    <div className="label-mgmt__row">
      <ColorPickerButton
        color={lbl.color}
        onChange={(color) => onUpdate({ labelId: lbl.id, color })}
      />

      {editing ? (
        <input
          type="text"
          className="label-mgmt__name-input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") {
              setEditName(lbl.name);
              setEditing(false);
            }
          }}
          maxLength={30}
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="label-mgmt__name-display"
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {lbl.name}
        </button>
      )}

      {lbl.taskCount > 0 && (
        <Text variant="body-3" color="muted" className="label-mgmt__task-count">
          {lbl.taskCount}
        </Text>
      )}

      <button
        type="button"
        className="label-mgmt__delete-btn"
        onClick={onDelete}
        aria-label={`Delete label ${lbl.name}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color Picker Button
// ---------------------------------------------------------------------------

/**
 * Simple CSS-positioned color picker that works reliably inside native
 * `<dialog>` elements. Uses relative/absolute positioning instead of
 * floating-ui to avoid top-layer positioning issues.
 */
function ColorPickerButton({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="label-mgmt__color-container">
      <button
        type="button"
        className="label-mgmt__color-dot"
        style={{ backgroundColor: color }}
        aria-label="Change color"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="label-mgmt__color-picker label-mgmt__color-picker--inline">
          <div className="label-mgmt__color-grid">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="label-mgmt__color-swatch"
                style={{ backgroundColor: c }}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                aria-label={`Select color ${c}`}
              >
                {c === color && <Check size={12} className="text-white" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
