import { useState } from "react";

import { changePasswordSchema } from "@/shared/schemas/user";
import { Field, FieldError, Label, PasswordInput } from "@/web/components/form";
import { Stack } from "@/web/components/layout";
import { Alert, Button, Card, Text } from "@/web/components/ui";
import { changePassword } from "@/web/lib/auth/auth-client";

export function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setSuccess("");

    const result = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.errors) {
        const key = issue.path[0]?.toString();
        if (key) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    try {
      const { error: changeError } = await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      });
      if (changeError) {
        setError(changeError.message ?? "Failed to change password");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password changed successfully.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Stack gap="r4">
        <Text variant="h5">Change Password</Text>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <Stack gap="r4">
            <Field>
              <Label htmlFor="currentPassword">Current Password</Label>
              <PasswordInput
                id="currentPassword"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                error={!!fieldErrors.currentPassword}
              />
              <FieldError>{fieldErrors.currentPassword}</FieldError>
            </Field>

            <Field>
              <Label htmlFor="newPassword">New Password</Label>
              <PasswordInput
                id="newPassword"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                error={!!fieldErrors.newPassword}
              />
              <FieldError>{fieldErrors.newPassword}</FieldError>
            </Field>

            <Field>
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                error={!!fieldErrors.confirmPassword}
              />
              <FieldError>{fieldErrors.confirmPassword}</FieldError>
            </Field>

            {error && <Alert variant="error">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Button type="submit" variant="primary" size="md" disabled={loading}>
              {loading ? "Changing..." : "Change Password"}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Card>
  );
}
