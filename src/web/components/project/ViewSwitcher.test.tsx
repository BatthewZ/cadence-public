/**
 * Component tests for the Saved Views UI (ViewSwitcher + SaveViewButton).
 *
 * These tests are the verification demanded by the plan's risk note: the
 * rename/create inputs are embedded in a live DropdownMenu (floating-ui
 * focus manager, dismiss, typeahead), and the plain-div-row approach is only
 * acceptable if typing/Enter/Escape inside those inputs demonstrably does
 * not fight the menu machinery. They also pin the URL-write contract —
 * applying/creating a view must produce ONE navigation whose query string
 * comes from `viewStateToSearch` (deterministic order, `view=<id>` last) —
 * via a location probe rather than by spying on navigate, so a regression to
 * sequential param writes would fail these assertions no matter how it is
 * implemented.
 *
 * The api client is mocked as a tiny in-memory views DB so optimistic
 * mutations and their `onSettled` refetches stay consistent: a delete that
 * optimistically removes a row must not have the row resurrected by the
 * follow-up GET, which is exactly what a stateless `mockResolvedValue` would
 * do.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { SavedView } from "@/shared/schemas/saved-view";

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that depend on them
// ---------------------------------------------------------------------------

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", name: "Test Workspace", slug: "test" },
    members: [],
    projects: [],
    refetchProjects: vi.fn(),
    refetch: vi.fn(),
    loading: false,
    error: null,
  }),
}));

const mockToast = vi.fn();

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), dismissAll: vi.fn() }),
}));

vi.mock("@/web/lib/api/client", () => {
  /**
   * Mirrors the real ApiError shape (status + message). The component's
   * 409-vs-other branching is `err instanceof ApiError`, so the mock must
   * export a class — both the component and the tests resolve to THIS class
   * through the mocked module, keeping `instanceof` truthful.
   */
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

import { api, ApiError } from "@/web/lib/api/client";

// Typed as promise-returning mocks (not the bare `ReturnType<typeof vi.fn>`,
// whose void signature rejects the DB-backed `mockImplementation`s below).
const mockGet = api.get as Mock<(path: string) => Promise<unknown>>;
const mockPost = api.post as Mock<(path: string, body: unknown) => Promise<unknown>>;
const mockPatch = api.patch as Mock<(path: string, body: unknown) => Promise<unknown>>;
const mockDelete = api.delete as Mock<(path: string) => Promise<unknown>>;

// ---------------------------------------------------------------------------
// Polyfills for jsdom (floating-ui positioning)
// ---------------------------------------------------------------------------

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ---------------------------------------------------------------------------
// Dynamic import so mocks are established first
// ---------------------------------------------------------------------------

const { SaveViewButton, ViewSwitcher } = await import("./ViewSwitcher");

// ---------------------------------------------------------------------------
// In-memory views DB backing the mocked api client
// ---------------------------------------------------------------------------

let viewsDb: SavedView[] = [];

function makeView(overrides: Partial<SavedView> & { id: string; name: string }): SavedView {
  return {
    projectId: "proj-1",
    creatorId: "user-1",
    state: { tab: "board", params: {} },
    position: "a0",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Default DB-backed implementations. Individual tests override per-endpoint
 * behavior (e.g. a 409 rejection) with `mockImplementation`/`mockRejectedValue`.
 */
function installDbBackedApi() {
  mockGet.mockImplementation(() => Promise.resolve({ views: [...viewsDb] }));

  mockPost.mockImplementation((_path: string, body: unknown) => {
    const input = body as { name: string; state: SavedView["state"] };
    const view = makeView({ id: `v-new-${viewsDb.length + 1}`, name: input.name, state: input.state });
    viewsDb = [...viewsDb, view];
    return Promise.resolve({ view });
  });

  mockPatch.mockImplementation((path: string, body: unknown) => {
    const id = path.split("/").pop();
    viewsDb = viewsDb.map((v) => (v.id === id ? { ...v, ...(body as object) } : v));
    const view = viewsDb.find((v) => v.id === id);
    return Promise.resolve({ view });
  });

  mockDelete.mockImplementation((path: string) => {
    const id = path.split("/").pop();
    viewsDb = viewsDb.filter((v) => v.id !== id);
    return Promise.resolve({ ok: true, deletedId: id });
  });
}

// ---------------------------------------------------------------------------
// Render harness
// ---------------------------------------------------------------------------

/**
 * Echoes the live location so navigation side effects are asserted against
 * what a user's address bar would actually show (the spec's "location-probe
 * route") rather than against navigate-call internals.
 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

/**
 * Mounts both saved-views components exactly as TaskFilterBar composes them
 * (pill first, save affordance later in the row). SaveViewButton is mounted
 * UNconditionally here — in the app TaskFilterBar additionally gates it on
 * `hasActiveFilters` — so these tests exercise the component's own
 * self-gating (loaded + zero views + capturable state).
 */
function renderSwitcher(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ViewSwitcher projectId="proj-1" />
        <SaveViewButton projectId="proj-1" />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  viewsDb = [];
  installDbBackedApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ViewSwitcher", () => {
  it("renders nothing with no saved views and no capturable state", async () => {
    renderSwitcher("/w/test/projects/proj-1/board");

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith("/api/projects/proj-1/views");
    });

    // Pixel-identical bar: no pill, no save affordance — no buttons at all.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Views")).not.toBeInTheDocument();
    expect(screen.queryByText("Save view")).not.toBeInTheDocument();
  });

  it("saves the first view inline: POSTs captured state and navigates to the new view URL", async () => {
    const user = userEvent.setup();
    renderSwitcher("/w/test/projects/proj-1/board?assignee=u1,none&priority=high");

    // Zero views + active filters → quiet "Save view" affordance (no pill).
    const saveButton = await screen.findByRole("button", { name: /save view/i });
    expect(screen.queryByText("Views")).not.toBeInTheDocument();

    await user.click(saveButton);

    const input = screen.getByLabelText("View name");
    expect(input).toHaveFocus();

    await user.type(input, "Mine{Enter}");

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/api/projects/proj-1/views", {
        name: "Mine",
        state: {
          tab: "board",
          params: { assignee: "u1,none", priority: "high" },
        },
      });
    });

    // ONE navigation to the serialized state with the SERVER-assigned id
    // last ("?view=" identifies the active view across refreshes).
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/w/test/projects/proj-1/board?assignee=u1%2Cnone&priority=high&view=v-new-1",
      );
    });
  });

  it("applies a view: navigates to the stored tab with the serialized params plus view id", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "list", params: { priority: "high,urgent" } },
      }),
    ];
    const user = userEvent.setup();
    renderSwitcher("/w/test/projects/proj-1/board");

    // No active view → pill reads "Views".
    const pill = await screen.findByRole("button", { name: /views/i });
    await user.click(pill);

    const row = await screen.findByRole("menuitemradio", { name: "High priority" });
    expect(row).toHaveAttribute("aria-checked", "false");

    await user.click(row);

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/w/test/projects/proj-1/list?priority=high%2Curgent&view=v-1",
    );
  });

  it("clears the active view back to default: drops view + filters, keeps the open task and tab", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "list", params: { priority: "high" } },
      }),
    ];
    const user = userEvent.setup();
    // Active, clean view on the list tab with a task panel open.
    renderSwitcher("/w/test/projects/proj-1/list?priority=high&view=v-1&task=t-9");

    const pill = await screen.findByRole("button", { name: /high priority/i });
    await user.click(pill);

    // "Clear view" is offered even when the view is clean (it is the only
    // off-switch a radio group lacks).
    await user.click(await screen.findByRole("menuitem", { name: /clear view/i }));

    // ONE navigation to the SAME tab with the view id and its filters stripped,
    // but the open task preserved — the pill degrades back to "Views".
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/w/test/projects/proj-1/list?task=t-9",
    );
    expect(screen.getByText("Views")).toBeInTheDocument();
  });

  it("does not offer Clear view when no saved view is active", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "board", params: { priority: "high" } },
      }),
    ];
    const user = userEvent.setup();
    // Filters present but no view= param → nothing to "clear" at the view level.
    renderSwitcher("/w/test/projects/proj-1/board?priority=high");

    await user.click(await screen.findByRole("button", { name: /views/i }));
    expect(screen.queryByRole("menuitem", { name: /clear view/i })).not.toBeInTheDocument();
  });

  it("shows the muted Edited suffix when the URL diverges, and Update PATCHes the current state", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "board", params: { priority: "high" } },
      }),
    ];
    const user = userEvent.setup();
    // URL adds "urgent" to the multi-value priority list → genuinely dirty.
    renderSwitcher("/w/test/projects/proj-1/board?priority=high,urgent&view=v-1");

    const pill = await screen.findByRole("button", { name: /high priority/i });
    expect(pill).toHaveTextContent("Edited");

    await user.click(pill);
    await user.click(await screen.findByRole("menuitem", { name: /update/i }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/api/projects/proj-1/views/v-1", {
        state: { tab: "board", params: { priority: "high,urgent" } },
      });
    });

    // Updating overwrites the snapshot in place — the URL must NOT change.
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/w/test/projects/proj-1/board?priority=high,urgent&view=v-1",
    );
  });

  it("does not show Edited when the URL only reorders a multi-value param", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "board", params: { priority: "high,urgent" } },
      }),
    ];
    renderSwitcher("/w/test/projects/proj-1/board?priority=urgent,high&view=v-1");

    const pill = await screen.findByRole("button", { name: /high priority/i });
    expect(pill).not.toHaveTextContent("Edited");
  });

  it("renames a view inline via the hover-revealed pencil (PATCHes only the name)", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "board", params: { priority: "high" } },
      }),
    ];
    const user = userEvent.setup();
    renderSwitcher("/w/test/projects/proj-1/board");

    await user.click(await screen.findByRole("button", { name: /views/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename view High priority" }),
    );

    const input = screen.getByLabelText("New name for High priority");
    expect(input).toHaveValue("High priority");
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, "Urgent stuff{Enter}");

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/api/projects/proj-1/views/v-1", {
        name: "Urgent stuff",
      });
    });

    // Menu stays open; the optimistic cache patch shows the new name at once.
    await screen.findByRole("menuitemradio", { name: "Urgent stuff" });
    expect(screen.queryByLabelText("New name for High priority")).not.toBeInTheDocument();
  });

  it("cancels a rename on Escape without closing the menu (the plan's flagged risk)", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "board", params: { priority: "high" } },
      }),
    ];
    const user = userEvent.setup();
    renderSwitcher("/w/test/projects/proj-1/board");

    await user.click(await screen.findByRole("button", { name: /views/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename view High priority" }),
    );
    expect(screen.getByLabelText("New name for High priority")).toBeInTheDocument();

    // Escape must mean "cancel the input", NOT "dismiss the menu": the
    // input stops propagation so the menu's dismiss handler never sees it.
    await user.keyboard("{Escape}");

    expect(
      screen.queryByLabelText("New name for High priority"),
    ).not.toBeInTheDocument();
    // The menu survived — the row is back in place and nothing was PATCHed.
    expect(
      screen.getByRole("menuitemradio", { name: "High priority" }),
    ).toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("deletes the ACTIVE view and degrades the pill to Views (dangling view param ignored)", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "board", params: { priority: "high" } },
      }),
      makeView({ id: "v-2", name: "Bugs", state: { tab: "board", params: { label: "l-bug" } } }),
    ];
    const user = userEvent.setup();
    renderSwitcher("/w/test/projects/proj-1/board?priority=high&view=v-1");

    // v-1 is active and clean.
    const pill = await screen.findByRole("button", { name: /high priority/i });
    await user.click(pill);

    await user.click(
      await screen.findByRole("menuitem", { name: "Delete view High priority" }),
    );

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("/api/projects/proj-1/views/v-1");
    });

    // Optimistic removal: the row disappears without waiting for refetch …
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitemradio", { name: "High priority" }),
      ).not.toBeInTheDocument();
    });
    // … the other view survives, and the pill degrades: the URL still says
    // view=v-1, but an unresolvable id means "no active view".
    expect(screen.getByRole("menuitemradio", { name: "Bugs" })).toBeInTheDocument();
    expect(screen.getByText("Views")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("view=v-1");
  });

  it("silently ignores an unresolvable view id in the URL (shared-link recipient)", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "board", params: { priority: "high" } },
      }),
    ];
    renderSwitcher("/w/test/projects/proj-1/board?priority=high&view=v-someone-elses");

    const pill = await screen.findByRole("button", { name: /views/i });
    expect(pill).not.toHaveTextContent("High priority");
    expect(pill).not.toHaveTextContent("Edited");
  });

  it("applies a view saved on an unknown tab (future client) to the board tab", async () => {
    viewsDb = [
      makeView({
        id: "v-cal",
        name: "Calendar view",
        state: { tab: "calendar", params: { priority: "low" } },
      }),
    ];
    const user = userEvent.setup();
    renderSwitcher("/w/test/projects/proj-1/list");

    await user.click(await screen.findByRole("button", { name: /views/i }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Calendar view" }));

    // "calendar" is not renderable by this client → resolveViewTab falls
    // back to board instead of building a dead route.
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/w/test/projects/proj-1/board?priority=low&view=v-cal",
    );
  });

  it("shows the duplicate-name error inline on 409 and keeps the input for correction", async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValue(new ApiError(409, "A view with this name already exists"));
    renderSwitcher("/w/test/projects/proj-1/board?priority=high");

    await user.click(await screen.findByRole("button", { name: /save view/i }));
    await user.type(screen.getByLabelText("View name"), "Dup{Enter}");

    // Inline (under the input), not a toast — the user fixes it in place.
    expect(
      await screen.findByText("You already have a view with this name"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("View name")).toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();

    // No navigation happened — the URL is untouched by the failed create.
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/w/test/projects/proj-1/board?priority=high",
    );
  });

  it("surfaces the saved-views cap (400) through a toast with the server message", async () => {
    viewsDb = [
      makeView({
        id: "v-1",
        name: "High priority",
        state: { tab: "board", params: { priority: "high" } },
      }),
    ];
    const user = userEvent.setup();
    mockPost.mockRejectedValue(new ApiError(400, "Saved view limit reached (20)"));
    renderSwitcher("/w/test/projects/proj-1/board?priority=urgent");

    await user.click(await screen.findByRole("button", { name: /views/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Save current as view" }),
    );
    await user.type(screen.getByLabelText("View name"), "One too many{Enter}");

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Saved view limit reached (20)", {
        variant: "error",
      });
    });
  });
});
