import { useState } from "react";

import { updateProfileSchema } from "@/shared/schemas/user";
import { Field, FieldError, Input, Label } from "@/web/components/form";
import { Stack } from "@/web/components/layout";
import { Alert, AvatarUpload, Button, Card, Text } from "@/web/components/ui";
import { useFieldErrors } from "@/web/hooks/use-field-errors";
import { updateUser, useSession } from "@/web/lib/auth/auth-client";

export function ProfileSection() {
  const { data: session } = useSession();
  const [name, setName] = useState(session?.user?.name ?? "");
  const [error, setError] = useState("");
  const { fieldErrors, clearFieldError, setFromZodError, resetFieldErrors } = useFieldErrors();
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    resetFieldErrors();
    setSuccess("");

    const result = updateProfileSchema.safeParse({ name });
    if (!result.success) {
      setFromZodError(result.error);
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await updateUser({ name });
      if (updateError) {
        setError(updateError.message ?? "Failed to update profile");
        return;
      }
      setSuccess("Profile updated successfully.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Stack gap="r4">
        <Text variant="h5">Profile</Text>

        <AvatarUpload
          src={session?.user?.image}
          name={session?.user?.name ?? ""}
          size="xl"
        />

        <form onSubmit={(e) => void handleSubmit(e)}>
          <Stack gap="r4">
            <Field>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={session?.user?.email ?? ""}
                disabled
                aria-readonly="true"
              />
              <Text variant="body-3" color="muted">
                Email address cannot be changed.
              </Text>
            </Field>

            <Field>
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFieldError("name");
                }}
                error={!!fieldErrors.name}
              />
              <FieldError>{fieldErrors.name}</FieldError>
            </Field>

            {error && <Alert variant="error">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Button type="submit" variant="primary" size="md" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Card>
  );
}
