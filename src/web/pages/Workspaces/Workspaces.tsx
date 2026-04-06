import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Layers, Plus, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Center, Container, Row } from "@/web/components/layout";
import { UserMenu } from "@/web/components/layout/UserMenu";
import {
  Alert,
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateIcon,
  EmptyStateTitle,
  Spinner,
  Text,
} from "@/web/components/ui";
import { type WorkspacesResponse } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useThemeApplication } from "@/web/hooks/use-theme";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";

import { CreateWorkspaceDialog } from "./components/CreateWorkspaceDialog";
import { getGreeting, getWorkspaceColor, getWorkspaceInitial } from "./components/helpers";
import { PendingInvitations } from "./components/PendingInvitations";

export default function Workspaces() {
  useDocumentTitle("Workspaces");
  // Reset theme to default when on workspace list (outside any workspace context)
  useThemeApplication(null, null);

  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const { data, isLoading: loading, error } = useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => api.get<WorkspacesResponse>("/api/workspaces"),
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  const workspaces = data?.workspaces ?? [];
  const firstName = session?.user?.name?.split(" ")[0] ?? "";

  function handleSelectWorkspace(slug: string) {
    localStorage.setItem("lastWorkspaceSlug", slug);
    void navigate(`/w/${slug}/dashboard`);
  }

  if (loading) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }

  return (
    <div className="min-h-screen bg-surface-1 flex flex-col">
      {/* Top bar */}
      <div className="bg-surface-0 border-b border-border-default">
        <Container size="lg">
          <Row justify="between" align="center" className="h-14">
            <Row gap="r4" align="center">
              <img src="/favicon.png" alt="Cadence" className="w-8 h-8" />
              <Text variant="h6" className="tracking-tight">Cadence</Text>
            </Row>
            {session?.user && <UserMenu />}
          </Row>
        </Container>
      </div>

      <Container size="lg" className="flex-1 flex flex-col justify-center pt-r1 pb-r2">
        {/* Greeting */}
        <div className="pt-r2 pb-r3">
          <Text variant="h3" className="tracking-tight">
            {getGreeting()}{firstName ? `, ${firstName}` : ""}
          </Text>
          <Text variant="body-2" color="secondary" className="mt-r6">
            {workspaces.length > 0
              ? "Select a workspace to continue, or create a new one."
              : "Get started by creating your first workspace."}
          </Text>
        </div>

        {error && (
          <Alert variant="error" className="mb-r4">{error.message}</Alert>
        )}

        <PendingInvitations />

        {workspaces.length === 0 && !error ? (
          /* ── Empty state ── */
          <EmptyState size="lg">
            <EmptyStateIcon>
              <Layers size={36} />
            </EmptyStateIcon>
            <EmptyStateTitle>Create your first workspace</EmptyStateTitle>
            <EmptyStateDescription>
              Workspaces are where your team organizes projects, tracks tasks, and collaborates.
              Start by creating one for your team or personal use.
            </EmptyStateDescription>
            <EmptyStateActions>
              <Button size="lg" onClick={() => setDialogOpen(true)}>
                <Plus size={18} />
                Create Workspace
              </Button>
            </EmptyStateActions>
          </EmptyState>
        ) : (
          /* ── Workspace grid ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {workspaces.map((ws, i) => (
              <button
                key={ws.id}
                type="button"
                className="group text-left bg-surface-0 rounded-xl border border-border-default p-5 transition-all duration-fast hover:shadow-lg hover:border-accent/30 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                onClick={() => handleSelectWorkspace(ws.slug)}
              >
                <Row justify="between" align="start">
                  <div
                    className={`w-11 h-11 rounded-lg ${getWorkspaceColor(i)} flex items-center justify-center flex-shrink-0`}
                  >
                    <span className="text-white font-bold text-lg leading-none">
                      {getWorkspaceInitial(ws.name)}
                    </span>
                  </div>
                  <ArrowRight
                    size={16}
                    className="text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  />
                </Row>
                <div className="mt-3">
                  <Text variant="h5" className="group-hover:text-accent transition-colors">
                    {ws.name}
                  </Text>
                  {ws.description && (
                    <Text variant="body-3" color="secondary" className="mt-0.5 line-clamp-2">
                      {ws.description}
                    </Text>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-3">
                  <Users size={13} className="text-fg-muted flex-shrink-0" />
                  <Text variant="body-3" color="muted">
                    {ws.memberCount ?? 0} {(ws.memberCount ?? 0) === 1 ? "member" : "members"}
                  </Text>
                </div>
              </button>
            ))}

            {/* Create new workspace card */}
            <button
              type="button"
              className="text-left rounded-xl border-2 border-dashed border-border-default p-5 transition-all duration-fast hover:border-accent/40 hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              onClick={() => setDialogOpen(true)}
            >
              <div className="w-11 h-11 rounded-lg bg-surface-2 flex items-center justify-center">
                <Plus size={20} className="text-fg-muted" />
              </div>
              <div className="mt-3">
                <Text variant="body-2" className="font-medium">New Workspace</Text>
                <Text variant="body-3" color="muted" className="mt-0.5">
                  Start a new team or project
                </Text>
              </div>
            </button>
          </div>
        )}

        <CreateWorkspaceDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={(slug) => {
            void qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
            setDialogOpen(false);
            localStorage.setItem("lastWorkspaceSlug", slug);
            void navigate(`/w/${slug}/dashboard`);
          }}
        />
      </Container>
    </div>
  );
}
