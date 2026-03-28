import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/web/components/layout/NotificationPanel";

import Notifications from "./Notifications";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null } },
  }),
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useOptionalWorkspace: () => null,
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("@/web/hooks/use-invitation-actions", () => ({
  useInvitationActions: () => ({
    accept: vi.fn(),
    dismiss: vi.fn(),
    isAccepting: false,
  }),
}));

import { api } from "@/web/lib/api/client";
const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockPost = api.post as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NotificationsPage {
  notifications: Notification[];
  nextCursor: string | null;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function makeNotification(overrides: Partial<Notification> & { id: string }): Notification {
  return {
    type: "task_assigned",
    title: "You were assigned a task",
    body: null,
    read: false,
    actorName: "Bob",
    actorImage: null,
    workspaceId: "ws-1",
    projectId: "proj-1",
    taskId: "task-1",
    invitationId: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Tests for the Notifications page component which provides paginated
 * notification listing with filter tabs, mark-as-read, and load-more UX.
 * Regressions here break the primary notification reading experience.
 */
describe("Notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks for supporting queries
    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/api/workspaces")) {
        return Promise.resolve({ workspaces: [] });
      }
      if (url.includes("/api/notifications/unread-count")) {
        return Promise.resolve({ count: 0 });
      }
      if (url.includes("/api/invitations/pending")) {
        return Promise.resolve({ invitations: [] });
      }
      // Main notifications query — return empty by default
      if (url.includes("/api/notifications")) {
        return Promise.resolve({ notifications: [], nextCursor: null });
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders notification items from first page", async () => {
    const notifs = [
      makeNotification({ id: "n1", title: "Task assigned to you" }),
      makeNotification({ id: "n2", title: "New comment on your task" }),
    ];

    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/api/workspaces")) return Promise.resolve({ workspaces: [] });
      if (url.includes("/api/notifications/unread-count")) return Promise.resolve({ count: 2 });
      if (url.includes("/api/invitations/pending")) return Promise.resolve({ invitations: [] });
      if (url.includes("/api/notifications")) {
        return Promise.resolve({ notifications: notifs, nextCursor: null } as NotificationsPage);
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Notifications />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Task assigned to you")).toBeInTheDocument();
      expect(screen.getByText("New comment on your task")).toBeInTheDocument();
    });
  });

  it('shows "Load more" button when hasNextPage is true', async () => {
    const notifs = [makeNotification({ id: "n1", title: "Notification 1" })];

    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/api/workspaces")) return Promise.resolve({ workspaces: [] });
      if (url.includes("/api/notifications/unread-count")) return Promise.resolve({ count: 0 });
      if (url.includes("/api/invitations/pending")) return Promise.resolve({ invitations: [] });
      if (url.includes("/api/notifications")) {
        return Promise.resolve({
          notifications: notifs,
          nextCursor: "2025-01-01T00:00:00.000Z",
        } as NotificationsPage);
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Notifications />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Load more")).toBeInTheDocument();
    });
  });

  it('hides "Load more" when all pages are loaded', async () => {
    const notifs = [makeNotification({ id: "n1", title: "Only notification" })];

    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/api/workspaces")) return Promise.resolve({ workspaces: [] });
      if (url.includes("/api/notifications/unread-count")) return Promise.resolve({ count: 0 });
      if (url.includes("/api/invitations/pending")) return Promise.resolve({ invitations: [] });
      if (url.includes("/api/notifications")) {
        return Promise.resolve({
          notifications: notifs,
          nextCursor: null,
        } as NotificationsPage);
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Notifications />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Only notification")).toBeInTheDocument();
    });

    expect(screen.queryByText("Load more")).toBeNull();
  });

  it("renders empty state correctly", async () => {
    // Default mock already returns empty notifications
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Notifications />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("No notifications yet")).toBeInTheDocument();
    });
  });

  it("mark-all-read button triggers mutation", async () => {
    const notifs = [makeNotification({ id: "n1", title: "Unread notification" })];

    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/api/workspaces")) return Promise.resolve({ workspaces: [] });
      if (url.includes("/api/notifications/unread-count")) return Promise.resolve({ count: 1 });
      if (url.includes("/api/invitations/pending")) return Promise.resolve({ invitations: [] });
      if (url.includes("/api/notifications")) {
        return Promise.resolve({ notifications: notifs, nextCursor: null } as NotificationsPage);
      }
      return Promise.resolve({});
    });
    mockPost.mockResolvedValue({ ok: true });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Notifications />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Unread notification")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const markAllButton = screen.getByText("Mark all read");
    await user.click(markAllButton);

    expect(mockPost).toHaveBeenCalledWith("/api/notifications/mark-all-read", {});
  });

  it("disables mark-all-read button when no unread notifications", async () => {
    // unread count is 0 (default mock)
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Notifications />
      </Wrapper>,
    );

    await waitFor(() => {
      const markAllButton = screen.getByText("Mark all read");
      expect(markAllButton.closest("button")).toBeDisabled();
    });
  });
});
