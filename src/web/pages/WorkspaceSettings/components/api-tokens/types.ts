/* ------------------------------------------------------------------ */
/*  API Token domain types (frontend mirror of backend shape)          */
/*                                                                     */
/*  These types describe the shape returned by                         */
/*  GET /api/workspaces/:workspaceId/api-tokens and friends. They are  */
/*  intentionally local to the UI: the backend is the source of truth  */
/*  and these types only need to match the JSON wire format.           */
/* ------------------------------------------------------------------ */

export type ProjectScopeMode = "all" | "selected";

export type ExpiryOption = 30 | 90 | 365 | "never";

/**
 * A token as returned by the list/detail endpoints.
 * `tokenHash` is NEVER returned by the server.
 * `plaintext` is ONLY returned by create/rotate responses, never by list/detail.
 */
export interface ApiTokenRow {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  tokenPrefix: string;

  /** Pre-parsed by the API (the table column is a JSON string; handlers decode). */
  scopes: string[];
  projectScope: ProjectScopeMode;
  /** Pre-parsed array of project IDs; null when projectScope === "all". */
  projectIds: string[] | null;

  lastUsedAt: string | null;
  expiresAt: string | null;
  /** Scheduled future revocation timestamp (set when a token is rotated). */
  revokeAt: string | null;
  /** Actually revoked timestamp (soft-delete marker). */
  revokedAt: string | null;
  rotatedToId: string | null;

  createdAt: string;
}

/**
 * Create / rotate responses include the plaintext token exactly once.
 */
export interface ApiTokenWithPlaintext extends ApiTokenRow {
  plaintext: string;
}

export interface ListApiTokensResponse {
  tokens: ApiTokenRow[];
}

export interface ApiTokenResponse {
  token: ApiTokenRow;
}

export interface ApiTokenCreatedResponse {
  token: ApiTokenWithPlaintext;
}

/* ------------------------------------------------------------------ */
/*  Scope catalog (UI-side mirror)                                     */
/*                                                                     */
/*  This is the source-of-truth shown in the create dialog. The        */
/*  backend validates against its own list; we deliberately surface    */
/*  the same human-friendly grouping here for clarity.                 */
/* ------------------------------------------------------------------ */

export interface ScopeGroup {
  label: string;
  description: string;
  scopes: { value: string; label: string }[];
}

export const SCOPE_GROUPS: ScopeGroup[] = [
  {
    label: "Workspace",
    description: "Read or modify workspace settings.",
    scopes: [
      { value: "workspace:read", label: "Read workspace" },
      { value: "workspace:write", label: "Modify workspace" },
    ],
  },
  {
    label: "Projects",
    description: "Read, modify, or delete projects.",
    scopes: [
      { value: "project:read", label: "Read projects" },
      { value: "project:write", label: "Modify projects" },
      { value: "project:delete", label: "Delete projects" },
    ],
  },
  {
    label: "Tasks",
    description: "Read, modify, or delete tasks.",
    scopes: [
      { value: "task:read", label: "Read tasks" },
      { value: "task:write", label: "Modify tasks" },
      { value: "task:delete", label: "Delete tasks" },
    ],
  },
  {
    label: "Labels",
    description: "Read or modify project labels.",
    scopes: [
      { value: "label:read", label: "Read labels" },
      { value: "label:write", label: "Modify labels" },
    ],
  },
  {
    label: "Attachments",
    description: "Read or upload task attachments.",
    scopes: [
      { value: "attachment:read", label: "Read attachments" },
      { value: "attachment:write", label: "Upload attachments" },
    ],
  },
  {
    label: "Teams",
    description: "Read or modify teams.",
    scopes: [
      { value: "team:read", label: "Read teams" },
      { value: "team:write", label: "Modify teams" },
    ],
  },
  {
    label: "Invitations",
    description: "Send workspace invitations.",
    scopes: [
      { value: "invitation:write", label: "Send invitations" },
    ],
  },
  {
    label: "Webhooks",
    description: "Manage outbound webhook subscriptions.",
    scopes: [
      { value: "webhook:read", label: "Read webhooks" },
      { value: "webhook:write", label: "Modify webhooks" },
    ],
  },
  {
    label: "Aggregates",
    description: "Grant every read or every write scope at once.",
    scopes: [
      { value: "read:*", label: "All read scopes" },
      { value: "write:*", label: "All write scopes" },
    ],
  },
];

/** Flat list of every scope value the UI knows about. */
export const ALL_KNOWN_SCOPES: string[] = SCOPE_GROUPS.flatMap((g) =>
  g.scopes.map((s) => s.value),
);

/** Every "*:read" scope plus the read-aggregate convenience. */
export const ALL_READ_SCOPES: string[] = ALL_KNOWN_SCOPES.filter((s) =>
  s.endsWith(":read"),
);

/* ------------------------------------------------------------------ */
/*  Lifecycle status derivation                                        */
/*                                                                     */
/*  A token can be in several lifecycle states; the wire format spreads */
/*  that information across multiple nullable timestamps so the UI     */
/*  must collapse them into a single badge.                            */
/* ------------------------------------------------------------------ */

export type TokenStatus = "active" | "rotating" | "expired" | "revoked";

export function deriveStatus(token: ApiTokenRow, now: Date = new Date()): TokenStatus {
  if (token.revokedAt) return "revoked";
  if (token.expiresAt && new Date(token.expiresAt).getTime() < now.getTime()) {
    return "expired";
  }
  // A scheduled revocation in the future means we're in a rotation grace window.
  if (token.revokeAt && new Date(token.revokeAt).getTime() > now.getTime()) {
    return "rotating";
  }
  return "active";
}
