# TypeScript Configuration

## Two TypeScript Configurations

The project uses a [project references](https://www.typescriptlang.org/docs/handbook/project-references.html) setup with a root `tsconfig.json` that references two sub-configs:

```json
// tsconfig.json (root)
{
  "files": [],
  "references": [
    { "path": "./tsconfig.backend.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

### Why Two Configs?

The backend and frontend run in fundamentally different environments with different global types:

| | `tsconfig.backend.json` | `tsconfig.web.json` |
|---|---|---|
| **Environment** | Cloudflare Workers | Browser |
| **Global types** | `@cloudflare/workers-types` | `DOM`, `DOM.Iterable`, `@types/react`, `@types/react-dom` |
| **Includes** | `src/api/**/*`, `src/db/**/*`, `src/shared/**/*` | `src/web/**/*`, `src/shared/**/*` |
| **JSX** | Not configured | `react-jsx` |

If these were combined into a single config:

- Backend code would see `window`, `document`, and DOM APIs (which do not exist in Workers).
- Frontend code would see `D1Database`, `KVNamespace`, and other Workers types (which do not exist in browsers).

The `src/shared/` directory is included in **both** configs. This is intentional -- shared code (Zod schemas, types, constants) must type-check in both environments.

### Type-checking

The `typecheck` script runs both configs:

```bash
bun run typecheck
# Expands to:
# tsc --noEmit -p tsconfig.backend.json && tsc --noEmit -p tsconfig.web.json
```

---

## The `@/` Path Alias

Both TypeScript configs and Vite define a path alias `@/` that maps to the `src/` directory:

```json
// In both tsconfig.backend.json and tsconfig.web.json
"paths": {
  "@/*": ["./src/*"]
}
```

```ts
// vite.config.ts
resolve: {
  alias: {
    "@": path.resolve(__dirname, "./src"),
  },
},
```

This allows imports like:

```ts
import { useSession } from "@/web/lib/auth/auth-client";
import { loginSchema } from "@/shared/schemas/auth";
```

The alias is configured in three places because each tool resolves imports independently:

1. **`tsconfig.backend.json`** -- so `tsc` resolves `@/` in backend code.
2. **`tsconfig.web.json`** -- so `tsc` resolves `@/` in frontend code.
3. **`vite.config.ts`** -- so Vite's bundler resolves `@/` at build time.
