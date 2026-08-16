import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, type Mock,vi } from "vitest";

import { ToastProvider } from "@/web/components/ui/ToastContext";
import { api } from "@/web/lib/api/client";

import type { ApiTokenRow } from "./api-tokens/types";

vi.mock("@/web/lib/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/web/hooks/use-workspace-projects", () => ({
  useWorkspaceProjects: () => ({ data: { projects: [] }, isLoading: false }),
}));

/** Flipped per-test to exercise the member (non-issuer) state. */
let mockCanManage = true;
/** False reproduces the pre-roster render, where the role is not yet known. */
let mockResolved = true;

vi.mock("@/web/hooks/use-permissions", () => ({
  useWorkspacePermissions: () => ({
    workspaceRole: mockCanManage ? "owner" : "member",
    isWorkspaceOwner: mockCanManage,
    isWorkspaceAdmin: mockCanManage,
    canManageWorkspace: mockCanManage,
    canDeleteWorkspace: mockCanManage,
    isResolved: mockResolved,
  }),
}));

const { ApiTokensTab } = await import("./ApiTokensTab");

const mockGet = api.get as Mock<(path: string) => Promise<unknown>>;

const TOKEN: ApiTokenRow = {
  id: "tok_1",
  userId: "user-1",
  workspaceId: "ws-1",
  name: "Slack integration",
  tokenPrefix: "cdn_pat_abcd",
  scopes: ["task:read"],
  projectScope: "all",
  projectIds: null,
  lastUsedAt: null,
  expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  revokedAt: null,
  revokeAt: null,
  rotatedToId: null,
  createdAt: new Date().toISOString(),
};

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  const user = userEvent.setup();
  render(
    <Wrapper>
      <ApiTokensTab workspaceId="ws-1" />
    </Wrapper>,
  );
  return { user };
}

const NOTICE = /Only workspace owners and admins can create or rotate API tokens/;

describe("ApiTokensTab — issuance is owner/admin-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanManage = true;
    mockResolved = true;
    mockGet.mockResolvedValue({ tokens: [TOKEN] });
  });

  it("offers minting to an owner without showing the restriction notice", async () => {
    renderTab();

    expect(await screen.findByRole("button", { name: /New Token/ })).toBeEnabled();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("hides the mint control and explains why for a member", async () => {
    mockCanManage = false;
    renderTab();

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Token/ })).not.toBeInTheDocument();
  });

  it("disables Rotate but leaves Revoke available to a member", async () => {
    mockCanManage = false;
    const { user } = renderTab();

    await user.click(
      await screen.findByRole("button", { name: `Actions for ${TOKEN.name}` }),
    );

    // Rotate mints a fresh secret, so it is gated; revoking a token you
    // already hold is a security-positive action and stays open.
    expect(screen.getByRole("menuitem", { name: /Rotate/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: /Revoke/ })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("keeps Rotate available to an owner", async () => {
    const { user } = renderTab();

    await user.click(
      await screen.findByRole("button", { name: `Actions for ${TOKEN.name}` }),
    );

    expect(screen.getByRole("menuitem", { name: /Rotate/ })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("withholds the accusation until the role is known, but still fails closed", async () => {
    // The pre-roster render looks exactly like `member`. Claiming a real
    // admin lacks permission and then retracting it is the failure mode the
    // `isResolved` contract exists to prevent — so the notice waits, while
    // the mint control stays hidden.
    mockCanManage = false;
    mockResolved = false;
    renderTab();

    expect(await screen.findByText(TOKEN.name)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Token/ })).not.toBeInTheDocument();
  });

  it("does not tell an unresolved caller they cannot mint from the empty state", async () => {
    mockCanManage = false;
    mockResolved = false;
    mockGet.mockResolvedValue({ tokens: [] });
    renderTab();

    expect(await screen.findByText("No API tokens yet")).toBeInTheDocument();
    expect(
      screen.queryByText(/A workspace owner or admin can issue a token/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Token/ })).not.toBeInTheDocument();
  });

  it("does not invite a member to generate a token from the empty state", async () => {
    mockCanManage = false;
    mockGet.mockResolvedValue({ tokens: [] });
    renderTab();

    expect(await screen.findByText("No API tokens yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Token/ })).not.toBeInTheDocument();
    expect(
      screen.getByText(/A workspace owner or admin can issue a token/),
    ).toBeInTheDocument();
  });
});
