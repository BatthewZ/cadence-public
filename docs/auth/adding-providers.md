# Adding Auth Providers

Better Auth supports multiple auth providers (Google, GitHub, etc.). To add one:

1. **Update `src/api/lib/auth.ts`**: Add the provider to the `createAuth` configuration. For example, for GitHub:

   ```ts
   import { github } from "better-auth/providers";

   export function createAuth(d1: D1Database, env: AppBindings) {
     return betterAuth({
       // ... existing config
       socialProviders: {
         github: {
           clientId: env.GITHUB_CLIENT_ID,
           clientSecret: env.GITHUB_CLIENT_SECRET,
         },
       },
     });
   }
   ```

2. **Update `src/api/env.ts`**: Add the new environment variables to `AppBindings`:

   ```ts
   export type AppBindings = {
     // ... existing bindings
     GITHUB_CLIENT_ID: string;
     GITHUB_CLIENT_SECRET: string;
   };
   ```

3. **Add environment variables**: Add the client ID and secret to `.dev.vars` (local) and Cloudflare dashboard (production).

4. **Update the frontend**: Add a social sign-in button that calls `signIn.social({ provider: "github" })`.

5. **Run migrations**: Better Auth may need additional database columns. Generate and apply migrations:

   ```bash
   bun run db:generate
   bun run db:migrate:local
   ```
