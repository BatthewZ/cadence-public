import type { Session, User } from "better-auth/types";

import type { Database } from "../db";
import type { ProjectRole, WorkspaceRole } from "../shared/types/roles";
import type { TelemetrySink } from "./lib/telemetry/types";

export type AppBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  TRUSTED_ORIGINS?: string;
  ASSETS: Fetcher;
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
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};
