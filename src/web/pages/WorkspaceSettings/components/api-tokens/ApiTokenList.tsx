import { AlertTriangle, KeyRound, MoreVertical, RefreshCw, Trash2 } from "lucide-react";

import { Row, Stack } from "@/web/components/layout";
import { Badge, Text, Tooltip } from "@/web/components/ui";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { IconButton } from "@/web/components/ui/IconButton";
import type { WorkspaceProjectSummary } from "@/web/hooks/use-workspace-projects";
import { formatRelativeFuture, formatRelativeTime } from "@/web/util/activity";

import {
  type ApiTokenRow,
  deriveStatus,
  type TokenStatus,
} from "./types";

/* ------------------------------------------------------------------ */
/*  ApiTokenList                                                       */
/*                                                                     */
/*  Renders the workspace's API tokens as a vertically stacked card    */
/*  list. Cards (not a dense table) keep the most security-relevant    */
/*  metadata — name, scopes, project access, last-used, expiry —       */
/*  scannable on narrow viewports while remaining keyboard accessible. */
/* ------------------------------------------------------------------ */

const STATUS_VARIANT: Record<TokenStatus, "success" | "warning" | "error" | "info" | "default"> = {
  active: "success",
  rotating: "info",
  expired: "warning",
  revoked: "error",
};

const STATUS_LABEL: Record<TokenStatus, string> = {
  active: "Active",
  rotating: "Rotating",
  expired: "Expired",
  revoked: "Revoked",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface ApiTokenListProps {
  tokens: ApiTokenRow[];
  projects: WorkspaceProjectSummary[];
  onRotate: (token: ApiTokenRow) => void;
  onRevoke: (token: ApiTokenRow) => void;
}

export function ApiTokenList({ tokens, projects, onRotate, onRevoke }: ApiTokenListProps) {
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  return (
    <Stack gap="r5">
      {tokens.map((token) => (
        <ApiTokenCard
          key={token.id}
          token={token}
          projectsById={projectsById}
          onRotate={() => onRotate(token)}
          onRevoke={() => onRevoke(token)}
        />
      ))}
    </Stack>
  );
}

/* ------------------------------------------------------------------ */
/*  ApiTokenCard                                                       */
/* ------------------------------------------------------------------ */

interface ApiTokenCardProps {
  token: ApiTokenRow;
  projectsById: Map<string, WorkspaceProjectSummary>;
  onRotate: () => void;
  onRevoke: () => void;
}

/**
 * Pure helper that turns a token's lifecycle timestamps into the values the
 * card needs to render. Extracted out of the component body so the lint
 * rule (components must be pure) is satisfied — we deliberately accept the
 * "now is a snapshot at render time" tradeoff because the only thing it
 * affects is the visual countdown which re-renders on data refetch.
 */
function computeLifecycle(token: ApiTokenRow) {
  const now = Date.now();
  const expiresAtMs = token.expiresAt ? new Date(token.expiresAt).getTime() : null;
  const expiresSoon =
    expiresAtMs !== null && expiresAtMs - now > 0 && expiresAtMs - now < 7 * MS_PER_DAY;

  const revokeAtMs = token.revokeAt ? new Date(token.revokeAt).getTime() : null;
  const daysUntilRevoke =
    revokeAtMs !== null && revokeAtMs > now
      ? Math.ceil((revokeAtMs - now) / MS_PER_DAY)
      : null;

  return { expiresSoon, daysUntilRevoke };
}

function ApiTokenCard({ token, projectsById, onRotate, onRevoke }: ApiTokenCardProps) {
  const status = deriveStatus(token);
  const scopes = token.scopes;
  const projectIds = token.projectIds ?? [];
  const projectNames = projectIds
    .map((id) => projectsById.get(id)?.name ?? "Unknown project")
    .sort((a, b) => a.localeCompare(b));

  const { expiresSoon, daysUntilRevoke } = computeLifecycle(token);
  const isRotating = status === "rotating" && daysUntilRevoke !== null;
  const isTerminal = status === "revoked" || status === "expired";

  return (
    <div className="bg-surface-0 rounded-lg border border-border-default/50 shadow-sm p-r3 transition-colors hover:border-border-default">
      <Stack gap="r4">
        {/* ----- Top row: name + status + actions ----- */}
        <Row justify="between" align="start" className="gap-r5 flex-wrap">
          <Row gap="r5" align="center" className="min-w-0 flex-1">
            <KeyRound size={18} className="text-fg-muted shrink-0" />
            <Stack gap="r6" className="min-w-0">
              <Tooltip content={token.name}>
                <Text
                  variant="body-2"
                  weight="semibold"
                  as="span"
                  className="block max-w-80 truncate"
                >
                  {token.name}
                </Text>
              </Tooltip>
              <code className="font-mono text-body-3 text-fg-muted">
                {token.tokenPrefix}
                {"…"}
              </code>
            </Stack>
          </Row>

          <Row gap="r5" align="center" className="shrink-0">
            <Badge variant={STATUS_VARIANT[status]}>
              {STATUS_LABEL[status]}
              {isRotating && (
                <span className="ml-r6">
                  &middot; revokes in {daysUntilRevoke}
                  {daysUntilRevoke === 1 ? " day" : " days"}
                </span>
              )}
            </Badge>

            <DropdownMenu placement="bottom-end">
              <DropdownMenu.Trigger asChild>
                <IconButton aria-label={`Actions for ${token.name}`}>
                  <MoreVertical size={16} />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item
                  index={0}
                  icon={<RefreshCw size={14} />}
                  onSelect={onRotate}
                  // Rotating tokens already have a pending sibling; the backend
                  // rejects a second rotation with 409. Expired/revoked tokens
                  // cannot be rotated either.
                  disabled={isTerminal || status === "rotating"}
                >
                  Rotate
                </DropdownMenu.Item>
                <DropdownMenu.Divider />
                <DropdownMenu.Item
                  index={1}
                  icon={<Trash2 size={14} />}
                  variant="danger"
                  onSelect={onRevoke}
                  disabled={status === "revoked"}
                >
                  Revoke
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </Row>
        </Row>

        {/* ----- Lifecycle row: single-value facts inline ----- */}
        {/* These three fields are different in kind from scopes: each is a   */}
        {/* single short value describing where this token can be used and   */}
        {/* when it lives/dies. Putting them on one wrappable line keeps the */}
        {/* card scannable and frees the row below for the full scope set.  */}
        <Row gap="r4" align="baseline" wrap>
          <LifecycleField label="Project access">
            <ProjectScopeCell
              projectScope={token.projectScope}
              projectNames={projectNames}
              projectCount={projectIds.length}
            />
          </LifecycleField>

          <LifecycleField label="Last used">
            {token.lastUsedAt ? (
              <Text variant="body-3" as="span">
                {formatRelativeTime(token.lastUsedAt)}
              </Text>
            ) : (
              <Text variant="body-3" color="muted" as="span">
                Never used
              </Text>
            )}
          </LifecycleField>

          <LifecycleField label="Expires">
            <ExpiryCell
              expiresAt={token.expiresAt}
              expiresSoon={expiresSoon}
              status={status}
            />
          </LifecycleField>
        </Row>

        {/* ----- Scopes: full-width, partitioned into Read / Write ----- */}
        {/* Security-critical capability data: every granted scope is shown */}
        {/* without truncation so an auditor can see the full surface area  */}
        {/* in one glance. Read vs Write split makes the read/mutation     */}
        {/* posture immediately readable; the count beside each caption    */}
        {/* answers "how broad is this token's authority?" at a glance.    */}
        <ScopeSections scopes={scopes} />
      </Stack>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/**
 * Inline label + value pair used by the lifecycle row.
 *
 * The label is rendered uppercase/muted so the value reads as the focal point
 * while still being scannable as a labeled stat. `align="baseline"` ensures the
 * label and a multi-element value (e.g. an icon-prefixed expiry warning) sit on
 * the same text baseline rather than centre-of-line.
 */
function LifecycleField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Row gap="r6" align="baseline">
      <Text
        variant="body-3"
        color="muted"
        as="span"
        className="uppercase tracking-wide"
      >
        {label}
      </Text>
      <div className="flex items-baseline">{children}</div>
    </Row>
  );
}

/**
 * Partition function: separates a token's flat scope list into the two visual
 * sections shown on the card.
 *
 * Categorisation rules:
 *  - Read    -> `read:*` (the aggregate) and any `<resource>:read`
 *  - Write   -> `write:*` (the aggregate) and any `<resource>:write` or
 *               `<resource>:delete`. Delete is folded into Write because it
 *               is a destructive mutation, not a separate axis the user has
 *               asked us to surface; keeping two sections matches the
 *               agreed UX direction.
 *  - Other   -> defensive bucket for unknown / future scope shapes so that
 *               nothing silently disappears from the card during a security
 *               review. Hidden when empty.
 *
 * Within each section the aggregate (`read:*` / `write:*`) is hoisted to the
 * front because it confers broad authority and an auditor should see it
 * first.
 */
function partitionScopes(scopes: string[]): {
  read: string[];
  write: string[];
  other: string[];
} {
  const read: string[] = [];
  const write: string[] = [];
  const other: string[] = [];

  for (const scope of scopes) {
    if (scope === "read:*" || scope.endsWith(":read")) {
      read.push(scope);
    } else if (
      scope === "write:*" ||
      scope.endsWith(":write") ||
      scope.endsWith(":delete")
    ) {
      write.push(scope);
    } else {
      other.push(scope);
    }
  }

  const sortWithAggregateFirst = (aggregate: string) => (a: string, b: string) => {
    if (a === aggregate) return -1;
    if (b === aggregate) return 1;
    return a.localeCompare(b);
  };

  read.sort(sortWithAggregateFirst("read:*"));
  write.sort(sortWithAggregateFirst("write:*"));
  other.sort((a, b) => a.localeCompare(b));

  return { read, write, other };
}

/**
 * Renders the full scope set as two (occasionally three) labelled chip rows.
 *
 * Why this exists instead of a `+N more` collapse: API tokens are a security
 * surface. Hiding capabilities behind a tooltip means an auditor has to hover
 * each card to know what a token can actually do. The agreed tradeoff is
 * deliberate information density — chip walls are acceptable, and the
 * info-coloured chips intentionally let "how much blue" act as an at-a-glance
 * proxy for "how broad is this token's authority?".
 */
function ScopeSections({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) {
    return (
      <Text variant="body-3" color="muted" as="span">
        No scopes
      </Text>
    );
  }

  const { read, write, other } = partitionScopes(scopes);

  return (
    <Stack gap="r5">
      <ScopeSection label="Read" scopes={read} />
      <ScopeSection label="Write" scopes={write} />
      {other.length > 0 && <ScopeSection label="Other" scopes={other} />}
    </Stack>
  );
}

function ScopeSection({ label, scopes }: { label: string; scopes: string[] }) {
  return (
    <Stack gap="r6">
      <Row gap="r6" align="baseline">
        <Text
          variant="body-3"
          color="muted"
          as="span"
          className="uppercase tracking-wide"
        >
          {label}
        </Text>
        <Text variant="body-3" color="muted" as="span">
          &middot; {scopes.length}
        </Text>
      </Row>
      {scopes.length > 0 ? (
        <Row gap="r6" wrap>
          {scopes.map((scope) => {
            // Destructive scopes (`*:delete`) are categorically different from
            // writes: a delete is typically irreversible, so an auditor should
            // see at a glance that a token can destroy data, not merely mutate
            // it. Warning-tinted chips create a sparse amber accent inside the
            // otherwise-uniform blue wall — preserving the "more blue = more
            // access" volume signal while adding a "what kind" signal on top.
            const isDestructive = scope.endsWith(":delete");
            return (
              <Badge
                key={scope}
                variant={isDestructive ? "warning" : "info"}
                className="font-mono"
              >
                {scope}
              </Badge>
            );
          })}
        </Row>
      ) : (
        <Text variant="body-3" color="muted" as="span">
          None
        </Text>
      )}
    </Stack>
  );
}

function ProjectScopeCell({
  projectScope,
  projectNames,
  projectCount,
}: {
  projectScope: "all" | "selected";
  projectNames: string[];
  projectCount: number;
}) {
  if (projectScope === "all") {
    return (
      <Text variant="body-3" as="span">
        All projects
      </Text>
    );
  }

  if (projectCount === 0) {
    return (
      <Text variant="body-3" color="muted" as="span">
        No projects
      </Text>
    );
  }

  const VISIBLE = 2;
  const preview = projectNames.slice(0, VISIBLE).join(", ");
  const hasMore = projectNames.length > VISIBLE;

  return (
    <Tooltip content={projectNames.join(", ")}>
      <span className="inline-flex items-baseline gap-r6 cursor-help">
        <Text variant="body-3" as="span">
          {projectCount} {projectCount === 1 ? "project" : "projects"}
        </Text>
        {preview && (
          <Text variant="body-3" color="muted" as="span" className="truncate max-w-40">
            ({preview}
            {hasMore ? ", ..." : ""})
          </Text>
        )}
      </span>
    </Tooltip>
  );
}

function ExpiryCell({
  expiresAt,
  expiresSoon,
  status,
}: {
  expiresAt: string | null;
  expiresSoon: boolean;
  status: TokenStatus;
}) {
  if (status === "revoked") {
    return (
      <Text variant="body-3" color="muted" as="span">
        Revoked
      </Text>
    );
  }
  if (!expiresAt) {
    return (
      <Text variant="body-3" color="muted" as="span">
        Never
      </Text>
    );
  }
  if (status === "expired") {
    return (
      <Row gap="r6" align="center">
        <AlertTriangle size={14} className="text-status-error shrink-0" />
        <Text variant="body-3" as="span" className="text-status-error">
          {formatRelativeFuture(expiresAt)}
        </Text>
      </Row>
    );
  }
  if (expiresSoon) {
    return (
      <Row gap="r6" align="center">
        <AlertTriangle size={14} className="text-status-warning shrink-0" />
        <Text variant="body-3" as="span" className="text-status-warning">
          {formatRelativeFuture(expiresAt)}
        </Text>
      </Row>
    );
  }
  return (
    <Text variant="body-3" as="span">
      {formatRelativeFuture(expiresAt)}
    </Text>
  );
}
