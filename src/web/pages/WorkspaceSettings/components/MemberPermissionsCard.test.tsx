import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPatch = vi.fn();
vi.mock("@/web/lib/api/client", () => ({
  api: {
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
  },
}));

const mockToast = vi.fn();
vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import type { WorkspaceDetail } from "@/web/contexts/WorkspaceContext";
import { queryKeys } from "@/web/lib/query-keys";

import { MemberPermissionsCard } from "./MemberPermissionsCard";

function makeWorkspace(allowMemberProjectCreation: boolean): WorkspaceDetail {
  return {
    id: "ws-1",
    name: "Test Workspace",
    slug: "test-workspace",
    ownerId: "user-1",
    policy: { allowMemberProjectCreation },
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderCard(allowMemberProjectCreation = true) {
  const workspace = makeWorkspace(allowMemberProjectCreation);
  // Seed the cache the way the real detail query would, so the optimistic
  // write has something to update — without this the rollback assertions
  // would pass vacuously against an empty cache.
  queryClient.setQueryData(queryKeys.workspaces.detail(workspace.id), { workspace });
  render(<MemberPermissionsCard workspace={workspace} />, { wrapper });
  return workspace;
}

function cachedPolicy(workspaceId: string) {
  return queryClient.getQueryData<{ workspace: WorkspaceDetail }>(
    queryKeys.workspaces.detail(workspaceId),
  )?.workspace.policy;
}

/**
 * The card is the only place a workspace's governance policy can be changed
 * through the UI, and it applies each change immediately rather than behind a
 * Save button.
 *
 * That choice is what these tests defend. A switch that applies on release
 * must be honest in both directions: it moves at once (or it reads as broken
 * and invites the double-click that sends a contradictory second request), and
 * it moves BACK when the server refuses (or it sits in a position the backend
 * never accepted, quietly telling an admin that members are locked out when
 * they are not). Optimism without rollback is the worst of the three possible
 * designs, and it is also the easiest one to end up with by accident.
 */
describe("MemberPermissionsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  it("reflects the current policy in the toggle's state", () => {
    renderCard(true);

    expect(screen.getByRole("switch", { name: /members can create projects/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("reflects a disabled policy", () => {
    renderCard(false);

    expect(screen.getByRole("switch", { name: /members can create projects/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("sends only the changed toggle as a policy patch", async () => {
    mockPatch.mockResolvedValue({ workspace: makeWorkspace(false) });
    const workspace = renderCard(true);

    await userEvent.click(screen.getByRole("switch", { name: /members can create projects/i }));

    // A patch, not a whole-policy write. The server merges it, so sending only
    // what changed is what keeps two admins editing different toggles from
    // clobbering each other.
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(`/api/workspaces/${workspace.id}`, {
        policy: { allowMemberProjectCreation: false },
      });
    });
  });

  it("updates the cached workspace optimistically", async () => {
    let resolvePatch: (value: unknown) => void = () => {};
    mockPatch.mockImplementation(() => new Promise((resolve) => (resolvePatch = resolve)));
    const workspace = renderCard(true);

    await userEvent.click(screen.getByRole("switch", { name: /members can create projects/i }));

    // Asserted while the request is still in flight — this is the whole point
    // of the optimistic write, and it would pass trivially if checked after
    // the response landed.
    await waitFor(() => {
      expect(cachedPolicy(workspace.id)?.allowMemberProjectCreation).toBe(false);
    });

    resolvePatch({ workspace: makeWorkspace(false) });
  });

  it("rolls the cached policy back when the request fails", async () => {
    mockPatch.mockRejectedValue(new Error("nope"));
    const workspace = renderCard(true);

    await userEvent.click(screen.getByRole("switch", { name: /members can create projects/i }));

    await waitFor(() => {
      expect(cachedPolicy(workspace.id)?.allowMemberProjectCreation).toBe(true);
    });
  });

  it("tells the admin when the change did not stick", async () => {
    mockPatch.mockRejectedValue(new Error("nope"));
    renderCard(true);

    await userEvent.click(screen.getByRole("switch", { name: /members can create projects/i }));

    // A silent rollback is arguably worse than no rollback: the switch flicks
    // back on its own and the admin has no idea whether they mis-clicked or
    // the save failed.
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/could not update/i),
        { variant: "error" },
      );
    });
  });

  it("confirms a successful change", async () => {
    mockPatch.mockResolvedValue({ workspace: makeWorkspace(false) });
    renderCard(true);

    await userEvent.click(screen.getByRole("switch", { name: /members can create projects/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/updated/i), {
        variant: "success",
      });
    });
  });

  it("explains what turning the toggle off actually does", () => {
    renderCard(true);

    // The copy has to name the duplicate path too. A member who holds
    // project-admin on a project they created would otherwise read "cannot
    // create projects" and be surprised that Duplicate stops working — the
    // server refuses both, so the description must cover both.
    expect(screen.getByText(/duplicate/i)).toBeInTheDocument();
  });
});
