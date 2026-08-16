import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>(
    "@/web/lib/api/client",
  );
  return {
    ...actual,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

const mockToast = vi.fn();
vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), dismissAll: vi.fn() }),
}));

import { api } from "@/web/lib/api/client";

import { PendingInvitations } from "./PendingInvitations";

const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockPost = api.post as ReturnType<typeof vi.fn>;

function renderPendingInvitations() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const user = userEvent.setup();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  render(
    <Wrapper>
      <PendingInvitations />
    </Wrapper>,
  );
  return { user };
}

/**
 * The in-app pending-invitations list on the workspaces page.
 *
 * Why these tests matter: `GET /api/invitations/pending` used to hand the raw
 * invitation token to any session bearing the invited address, and this
 * component accepted with it (audit finding 04). The endpoint no longer
 * returns a token at all, so the component must accept by invitation **id** —
 * a change that is invisible to a test which only checks that the card
 * renders. The old code path was `inv.token && accept(inv.token)`, which
 * degrades to a silently dead button the moment the field disappears; that
 * exact failure mode is what the first test below pins down.
 */
describe("PendingInvitations", () => {
  const invitation = {
    id: "inv-42",
    role: "member",
    workspace: { id: "ws-1", name: "Design Team" },
    invitedBy: { id: "user-1", name: "Alice", email: "alice@test.com" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ invitations: [invitation] });
    mockPost.mockResolvedValue({ ok: true, workspaceId: "ws-1" });
  });

  it("accepts by invitation id, not by token", async () => {
    const { user } = renderPendingInvitations();

    await waitFor(() => {
      expect(screen.getByText("Design Team")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/api/invitations/accept", {
        invitationId: "inv-42",
      });
    });
    // A token in the body would mean the client is still relying on the
    // endpoint disclosing one.
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty("token");
  });

  it("renders nothing when there are no pending invitations", async () => {
    mockGet.mockResolvedValue({ invitations: [] });
    renderPendingInvitations();

    await waitFor(() => {
      expect(screen.queryByText("Pending Invitations")).toBeNull();
    });
  });

  it("removes a dismissed invitation from the list without calling the API", async () => {
    const { user } = renderPendingInvitations();

    await waitFor(() => {
      expect(screen.getByText("Design Team")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.queryByText("Design Team")).toBeNull();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
