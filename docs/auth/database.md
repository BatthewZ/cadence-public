# Auth Database Schema

Auth-related tables are defined in `src/db/schema/auth.ts` using Drizzle ORM:

| Table | Columns | Purpose |
|---|---|---|
| `user` | `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt` | User accounts. `emailVerified` is load-bearing, not informational: sign-in is refused while it is false, and it is what makes an email address usable as an identity when accepting a workspace invitation. Accounts created before verification became mandatory were set to verified by `migrations/0035_backfill_email_verified.sql` — the flag alone would have locked out the entire existing user base. See [Auth Flows § Email Verification](./flows.md#email-verification). |
| `session` | `id`, `userId`, `token`, `expiresAt`, `ipAddress`, `userAgent`, `createdAt`, `updatedAt` | Active sessions. Tracks IP and user agent for session management UI. Expired rows are pruned automatically by the [scheduled handler](../../src/api/scheduled/auth-cleanup.ts). |
| `account` | `id`, `userId`, `accountId`, `providerId`, `accessToken`, `refreshToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`, `password`, `createdAt`, `updatedAt` | Auth provider accounts. For email/password, `providerId` is `"credential"` and `password` holds the hash. |
| `verification` | `id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt` | Verification tokens (password reset, email verification). Abandoned expired tokens are pruned automatically by the [scheduled handler](../../src/api/scheduled/auth-cleanup.ts). |
