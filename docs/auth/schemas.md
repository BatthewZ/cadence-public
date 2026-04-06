# Validation Schemas

Zod schemas are defined in `src/shared/schemas/auth.ts` and used by both the frontend (form validation) and backend (request validation). All schemas are re-exported from the barrel `src/shared/schemas/index.ts`, so you can import from `@/shared/schemas` directly.

### `loginSchema`

```ts
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
```

### `registerSchema`

```ts
export const registerSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    tosAccepted: z.literal(true, {
      error: "You must accept the Terms of Service",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
```

### `acceptTosSchema`

**File:** `src/shared/schemas/legal.ts`

Used by the `POST /api/legal/accept-tos` endpoint to validate the ToS acceptance request body.

```ts
export const acceptTosSchema = z.object({
  tosVersion: z.string().min(1),
});
```

### `forgotPasswordSchema`

```ts
export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});
```

### `resetPasswordSchema`

```ts
export const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
```

### Exported Types

Each schema has a corresponding inferred type:

- `LoginInput`
- `RegisterInput`
- `ForgotPasswordInput`
- `ResetPasswordInput`
- `AcceptTosInput` (from `src/shared/schemas/legal.ts`)
