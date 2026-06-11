import type { Session, User } from "better-auth/types";

import type { Database } from "../db";
import type { ApiToken } from "../db/schema";
import type { ProjectRole, WorkspaceRole } from "../shared/types/roles";
import type { TelemetrySink } from "./lib/telemetry/types";

export type AppBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  TRUSTED_ORIGINS?: string;
  ASSETS: Fetcher;
  /**
   * Server-side pepper mixed into every PAT hash via HMAC-SHA256. Required
   * for any deployment that mints or verifies API tokens. Without the
   * pepper, a database exfiltration leaks values that match the unmodified
   * SHA-256 of any known candidate plaintext — the pepper turns the stored
   * hash into an HMAC keyed by a server-only secret, so DB-only access is
   * insufficient to verify guesses offline. See docs/api/api-tokens.md.
   *
   * Rotating the pepper invalidates every minted token (each one's stored
   * `tokenHash` was computed under the previous key). Treat rotation as a
   * forced re-mint event for all integrations.
   */
  TOKEN_HASH_PEPPER: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  STORAGE?: R2Bucket;
  ANALYTICS?: AnalyticsEngineDataset;
  TELEMETRY_SINK?: string;
  UNSPLASH_ACCESS_KEY?: string;
  UNSPLASH_SECRET_KEY?: string;
  UNSPLASH_APP_NAME?: string;
};

export type AuthVariables = {
  user: User | null;
  session: Session | null;
};

export type AppVariables = AuthVariables & {
  db: Database;
  requestId: string;
  telemetry?: TelemetrySink;
  workspaceMembership?: { id: string; workspaceId: string; role: WorkspaceRole } | null;
  projectAccess?: { role: ProjectRole; source: "workspace" | "project" } | null;
  currentProject?: { id: string; workspaceId: string } | null;
  apiToken?: ApiToken | null;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};
