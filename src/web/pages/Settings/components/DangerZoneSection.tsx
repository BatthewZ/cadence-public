import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Field, Input, Label } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import { Alert, Button, Card, Dialog, Text } from "@/web/components/ui";
import { deleteUser } from "@/web/lib/auth/auth-client";

export function DangerZoneSection() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (confirmText !== "DELETE") return;

    setError("");
    setLoading(true);
    try {
      const { error: deleteError } = await deleteUser();
      if (deleteError) {
        setError(deleteError.message ?? "Failed to delete account");
        return;
      }
      void navigate("/login");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setDialogOpen(false);
    setConfirmText("");
    setError("");
  }

  return (
    <>
      <Card className="border border-status-error/30">
        <Stack gap="r4">
          <Text variant="h5" className="text-status-error">
            Danger Zone
          </Text>
          <Text variant="body-2" color="secondary">
            Permanently delete your account and all associated data. This action cannot be undone.
          </Text>
          <div>
            <Button variant="danger" size="md" onClick={() => setDialogOpen(true)}>
              Delete Account
            </Button>
          </div>
        </Stack>
      </Card>

      <Dialog open={dialogOpen} onClose={handleClose}>
        <Stack gap="r4">
          <Text variant="h5">Delete Account</Text>
          <Text variant="body-2" color="secondary">
            This will permanently delete your account. Type <strong>DELETE</strong> to confirm.
          </Text>

          <Field>
            <Label htmlFor="confirmDelete">Confirmation</Label>
            <Input
              id="confirmDelete"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
            />
          </Field>

          {error && <Alert variant="error">{error}</Alert>}

          <Row gap="r4" justify="end">
            <Button variant="ghost" size="md" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void handleDelete()}
              disabled={confirmText !== "DELETE" || loading}
            >
              {loading ? "Deleting..." : "Delete Account"}
            </Button>
          </Row>
        </Stack>
      </Dialog>
    </>
  );
}
