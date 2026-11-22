import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", () => ({
  Navigate: ({ to }: { to: string }) => <div>redirect:{to}</div>,
  useParams: () => ({ workspaceSlug: "acme" }),
}));

import { queryKeys } from "@/web/lib/query-keys";

import { WorkspaceGuard } from "./WorkspaceGuard";

const acme = { id: "ws1", slug: "acme", name: "Acme" };

function renderGuard(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceGuard>
        <div>workspace</div>
      </WorkspaceGuard>
    </QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("WorkspaceGuard offline", () => {
  it("explains it can't load when the workspace list was never loaded here", () => {
    onlineManager.setOnline(false);
    renderGuard(newClient());

    expect(screen.getByText("You’re offline")).toBeInTheDocument();
    expect(screen.queryByText("redirect:/workspaces")).not.toBeInTheDocument();
  });

  it("explains it can't load when this workspace's detail was never loaded here", () => {
    onlineManager.setOnline(false);
    const client = newClient();
    client.setQueryData(queryKeys.workspaces.all, { workspaces: [acme] });
    renderGuard(client);

    expect(screen.getByText("You’re offline")).toBeInTheDocument();
    expect(screen.queryByText("workspace")).not.toBeInTheDocument();
  });

  it("renders the workspace from saved data while offline", () => {
    onlineManager.setOnline(false);
    const client = newClient();
    client.setQueryData(queryKeys.workspaces.all, { workspaces: [acme] });
    client.setQueryData(queryKeys.workspaces.detail("ws1"), { workspace: acme });
    renderGuard(client);

    expect(screen.getByText("workspace")).toBeInTheDocument();
  });
});
