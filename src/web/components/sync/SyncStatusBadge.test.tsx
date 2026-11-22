import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncStatus } from "@/web/lib/offline/outbox";
import type { QueuedWrite } from "@/web/lib/offline/perform-write";

const sync = vi.hoisted(() => ({
  status: {} as SyncStatus,
  online: true,
  writes: [] as QueuedWrite[],
  retry: vi.fn(),
  discard: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/web/lib/offline/hooks", () => ({
  useSyncStatus: () => sync.status,
  useOnline: () => sync.online,
  useQueuedWrites: () => sync.writes,
  useSyncActions: () => ({ retry: sync.retry, discard: sync.discard }),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => sync.navigate }));

import { SyncStatusBadge } from "./SyncStatusBadge";

// jsdom implements neither showModal nor close; toggle `open` as they do.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

function status(overrides: Partial<SyncStatus>): SyncStatus {
  return {
    online: true,
    pending: 0,
    sending: 0,
    state: "idle",
    blockedReason: null,
    nextRetryAt: null,
    lastError: null,
    ...overrides,
  };
}

function write(overrides: Partial<QueuedWrite>): QueuedWrite {
  return {
    v: 1,
    id: 1,
    method: "PATCH",
    path: "/api/tasks/t1",
    body: {},
    label: "Complete “Fix login”",
    order: 1,
    key: "k1",
    createdAt: Date.now() - 5 * 60_000,
    attempts: 0,
    stuck: false,
    lastError: null,
    ...overrides,
  };
}

function badge() {
  return within(screen.getByRole("status", { name: "Sync status" })).getByRole("button");
}

beforeEach(() => {
  sync.status = status({});
  sync.online = true;
  sync.writes = [];
  sync.retry.mockReset();
  sync.discard.mockReset();
  sync.navigate.mockReset();
});

describe("SyncStatusBadge", () => {
  it("renders nothing while online with nothing to sync", () => {
    const { container } = render(<SyncStatusBadge />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["offline, nothing queued", false, status({ pending: 0 }), "Offline"],
    ["offline with queued writes", false, status({ pending: 3 }), "Offline · 3 to sync"],
    ["syncing", true, status({ pending: 2, state: "syncing" }), "Syncing 2…"],
    [
      "waiting to retry",
      true,
      status({ pending: 4, state: "waiting", nextRetryAt: Date.now() + 5_000 }),
      "Retrying soon · 4",
    ],
    [
      "blocked by a stuck write",
      true,
      status({ pending: 1, state: "blocked", blockedReason: "stuck" }),
      "Can't sync",
    ],
    [
      "blocked by an ended session",
      true,
      status({ pending: 1, state: "blocked", blockedReason: "auth" }),
      "Sign in to sync",
    ],
  ])("labels the %s state", (_name, online, s, label) => {
    sync.online = online;
    sync.status = s;
    render(<SyncStatusBadge />);

    expect(badge()).toHaveAccessibleName(label);
  });

  it("lists the queued writes with their age when opened", async () => {
    sync.online = false;
    sync.status = status({ pending: 2 });
    sync.writes = [
      write({ id: 1, label: "Move “Fix login”" }),
      write({ id: 2, key: "k2", label: "Comment on “Fix login”" }),
    ];
    render(<SyncStatusBadge />);

    await userEvent.click(badge());

    const list = screen.getByRole("list", { name: "Changes waiting to sync" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Move “Fix login”");
    expect(items[0]).toHaveTextContent("5m ago");
    expect(items[1]).toHaveTextContent("Comment on “Fix login”");
    expect(screen.queryByRole("button", { name: "Retry now" })).not.toBeInTheDocument();
  });

  it("retries on request while waiting", async () => {
    sync.status = status({ pending: 1, state: "waiting" });
    sync.writes = [write({})];
    render(<SyncStatusBadge />);

    await userEvent.click(badge());
    await userEvent.click(screen.getByRole("button", { name: "Retry now" }));

    expect(sync.retry).toHaveBeenCalledOnce();
  });

  it("shows a stuck write's error and discards it only after confirming", async () => {
    sync.status = status({ pending: 2, state: "blocked", blockedReason: "stuck" });
    sync.writes = [
      write({ id: 7, stuck: true, attempts: 5, lastError: "Internal server error" }),
      write({ id: 8, key: "k2", label: "Rename “Roadmap”" }),
    ];
    render(<SyncStatusBadge />);

    await userEvent.click(badge());
    expect(screen.getByText("Internal server error")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Discard" })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(sync.discard).not.toHaveBeenCalled();
    const dialog = screen.getByText("Discard this change?").closest("dialog");
    expect(dialog).toHaveAttribute("open");

    // The closing popover still marks the rest of the page aria-hidden during its exit transition.
    await userEvent.click(within(dialog!).getByRole("button", { name: "Discard", hidden: true }));
    expect(sync.discard).toHaveBeenCalledWith(7);
  });

  it("sends the person to sign in when the session ended mid-sync", async () => {
    sync.status = status({ pending: 1, state: "blocked", blockedReason: "auth" });
    sync.writes = [write({})];
    render(<SyncStatusBadge />);

    await userEvent.click(badge());
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(sync.navigate).toHaveBeenCalledWith("/login");
    expect(screen.queryByRole("button", { name: "Retry now" })).not.toBeInTheDocument();
  });
});
