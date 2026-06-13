import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarFeedSection } from "./CalendarFeedSection";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiPost = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiDelete = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/web/lib/api/client", () => ({
  api: Object.assign(vi.fn(), {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  }),
}));

const mockToast = vi.fn();

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = "ws-1";
const FEED_PATH = `/api/workspaces/${WORKSPACE_ID}/calendar-feed`;
const FEED_URL = "https://cadence.example.com/api/calendar/cal_abc123.ics";

const emptyStatus = { exists: false, createdAt: null, lastUsedAt: null };

function existingStatus(overrides?: { lastUsedAt?: string | null }) {
  return {
    exists: true,
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), // 2h ago
    lastUsedAt:
      overrides && "lastUsedAt" in overrides
        ? overrides.lastUsedAt
        : new Date(Date.now() - 5 * 60_000).toISOString(), // 5m ago
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderSection() {
  const Wrapper = createWrapper();
  const user = userEvent.setup();
  render(
    <Wrapper>
      <CalendarFeedSection workspaceId={WORKSPACE_ID} />
    </Wrapper>,
  );
  return { user };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockApiGet.mockResolvedValue(emptyStatus);
  mockApiPost.mockResolvedValue({ url: FEED_URL });
  mockApiDelete.mockResolvedValue(undefined);

  // jsdom does not implement HTMLDialogElement.showModal / .close. Reflect
  // the `open` attribute in the mocks: jsdom's UA stylesheet hides
  // `dialog:not([open])`, so without this, Testing Library's role queries
  // cannot see the confirm dialog's buttons.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Tests for CalendarFeedSection — the account-settings surface for the
 * per-user workspace calendar feed (iCalendar subscription of assigned
 * tasks).
 *
 * Why these tests matter: the feed URL is a capability URL — possession
 * alone grants read access to the user's assigned task titles and dates.
 * The UI enforces a reveal-once posture (the URL is shown exactly once,
 * from the POST that mints it, and held in component state only), and
 * gates the two destructive actions (regenerate kills the old URL
 * instantly; revoke kills it with no replacement) behind confirmation
 * dialogs. Regressions here either leak the capability (URL lingering or
 * refetchable after dismissal) or break/destroy users' calendar
 * subscriptions without warning.
 */
describe("CalendarFeedSection", () => {
  // -----------------------------------------------------------------------
  // 1. No-feed state
  // -----------------------------------------------------------------------

  it("renders the generate CTA when no feed exists", async () => {
    renderSection();

    expect(
      await screen.findByRole("button", { name: "Generate calendar URL" }),
    ).toBeInTheDocument();
    expect(mockApiGet).toHaveBeenCalledWith(FEED_PATH);
  });

  it("renders the heading and capability-exposure help text in every state", async () => {
    renderSection();

    expect(screen.getByText("Calendar Feed")).toBeInTheDocument();
    expect(
      await screen.findByText(
        /Subscribe in Google Calendar, Apple Calendar, or Outlook\. Anyone with this URL can see your assigned task titles and dates\./,
      ),
    ).toBeInTheDocument();
  });

  it("does not show metadata, Regenerate, or Revoke when no feed exists", async () => {
    renderSection();

    await screen.findByRole("button", { name: "Generate calendar URL" });
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 2. Generate flow — reveal-once with copy
  // -----------------------------------------------------------------------

  it("POSTs to the feed endpoint and reveals the URL once", async () => {
    mockApiGet.mockResolvedValueOnce(emptyStatus).mockResolvedValue(existingStatus());
    const { user } = renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Generate calendar URL" }),
    );

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(FEED_PATH, {});
    });

    const revealed = await screen.findByTestId("calendar-feed-url");
    expect(revealed).toHaveTextContent(FEED_URL);
    expect(screen.getByText("You won't see this URL again.")).toBeInTheDocument();
  });

  it("copies the revealed URL to the clipboard", async () => {
    const { user } = renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Generate calendar URL" }),
    );
    await screen.findByTestId("calendar-feed-url");

    await user.click(
      screen.getByRole("button", { name: "Copy calendar URL to clipboard" }),
    );

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
    await expect(window.navigator.clipboard.readText()).resolves.toBe(FEED_URL);
  });

  it("hides the URL permanently after Done (reveal-once)", async () => {
    mockApiGet.mockResolvedValueOnce(emptyStatus).mockResolvedValue(existingStatus());
    const { user } = renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Generate calendar URL" }),
    );
    await screen.findByTestId("calendar-feed-url");

    await user.click(screen.getByRole("button", { name: "Done" }));

    // The plaintext must be gone from the DOM, and the section must fall
    // back to metadata-only status (refetched via invalidation) — there is
    // no path that re-displays the URL without minting a new one.
    expect(screen.queryByTestId("calendar-feed-url")).not.toBeInTheDocument();
    expect(await screen.findByText("iCalendar feed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });

  it("shows an error alert when generation fails", async () => {
    mockApiPost.mockRejectedValueOnce(new Error("Failed to create calendar feed"));
    const { user } = renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Generate calendar URL" }),
    );

    expect(
      await screen.findByText("Failed to create calendar feed"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-feed-url")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 3. Existing-feed state — metadata + actions
  // -----------------------------------------------------------------------

  it("shows created/last-fetched metadata with Regenerate and Revoke actions", async () => {
    mockApiGet.mockResolvedValue(existingStatus());
    renderSection();

    expect(await screen.findByText("iCalendar feed")).toBeInTheDocument();
    expect(screen.getByText("Created 2h ago")).toBeInTheDocument();
    expect(screen.getByText("Last fetched 5m ago")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Generate calendar URL" }),
    ).not.toBeInTheDocument();
  });

  it("shows 'Never fetched' when the feed has never been pulled", async () => {
    mockApiGet.mockResolvedValue(existingStatus({ lastUsedAt: null }));
    renderSection();

    expect(await screen.findByText("Never fetched")).toBeInTheDocument();
    expect(screen.queryByText(/Last fetched/)).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 4. Revoke flow — confirm dialog gates the DELETE
  // -----------------------------------------------------------------------

  it("revokes the feed via confirm dialog: DELETE + toast + back to CTA", async () => {
    mockApiGet.mockResolvedValueOnce(existingStatus()).mockResolvedValue(emptyStatus);
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: "Revoke" }));

    // Confirm dialog is mounted with destructive-consequence copy.
    expect(screen.getByText("Revoke Calendar Feed")).toBeInTheDocument();
    expect(
      screen.getByText(/Calendar apps subscribed with this URL will stop updating/),
    ).toBeInTheDocument();
    expect(mockApiDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Revoke Feed" }));

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith(FEED_PATH);
    });
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Calendar feed revoked.", {
        variant: "success",
      });
    });

    // Status invalidation refetches and the section returns to the CTA state.
    expect(
      await screen.findByRole("button", { name: "Generate calendar URL" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Revoke Calendar Feed")).not.toBeInTheDocument();
  });

  it("does not call DELETE when the revoke dialog is cancelled", async () => {
    mockApiGet.mockResolvedValue(existingStatus());
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApiDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("Revoke Calendar Feed")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 5. Regenerate flow — confirm dialog gates the replacement POST
  // -----------------------------------------------------------------------

  it("regenerates via confirm dialog: POST and reveal the replacement URL", async () => {
    mockApiGet.mockResolvedValue(existingStatus());
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: "Regenerate" }));

    expect(screen.getByText("Regenerate Calendar URL")).toBeInTheDocument();
    expect(
      screen.getByText(/immediately disables the current\s+one/),
    ).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Regenerate URL" }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(FEED_PATH, {});
    });

    const revealed = await screen.findByTestId("calendar-feed-url");
    expect(revealed).toHaveTextContent(FEED_URL);
    // Dialog closed once the reveal panel took over.
    expect(screen.queryByText("Regenerate Calendar URL")).not.toBeInTheDocument();
  });

  it("does not call POST when the regenerate dialog is cancelled", async () => {
    mockApiGet.mockResolvedValue(existingStatus());
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: "Regenerate" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApiPost).not.toHaveBeenCalled();
    expect(screen.queryByText("Regenerate Calendar URL")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 6. Status query error state
  // -----------------------------------------------------------------------

  it("shows an error with retry when the status query fails, and recovers", async () => {
    mockApiGet
      .mockRejectedValueOnce(new Error("Failed to load calendar feed"))
      .mockResolvedValue(existingStatus());
    const { user } = renderSection();

    expect(
      await screen.findByText("Failed to load calendar feed"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("iCalendar feed")).toBeInTheDocument();
  });
});
