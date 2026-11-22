import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  signOut: vi.fn(),
  pendingWriteCount: vi.fn(() => 0),
  wipeOfflineData: vi.fn<(userId: string) => Promise<void>>(() => Promise.resolve()),
  clearCachedSession: vi.fn<() => void>(),
  install: {
    available: false,
    installed: false,
    install: vi.fn(() => Promise.resolve("unavailable" as const)),
    help: { title: "Install Cadence", steps: ["Open the browser menu.", "Choose Install."] },
  },
}));

vi.mock("@/web/lib/pwa", () => ({ useInstall: () => m.install }));

vi.mock("react-router-dom", () => ({ useNavigate: () => m.navigate }));

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "u1", name: "Ada Lovelace", email: "ada@example.com", image: null } },
  }),
  signOut: (...args: unknown[]): unknown => m.signOut(...args),
}));

vi.mock("@/web/lib/offline/runtime", () => ({
  pendingWriteCount: () => m.pendingWriteCount(),
  wipeOfflineData: (userId: string) => m.wipeOfflineData(userId),
}));

vi.mock("@/web/lib/auth/session-cache", () => ({
  clearCachedSession: () => m.clearCachedSession(),
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({ useOptionalWorkspace: () => null }));
vi.mock("@/web/components/ui/AppShell", () => ({ useOptionalAppShell: () => null }));

import { SIGN_OUT_NEEDS_CONNECTION } from "@/web/components/sync/use-sign-out";

import { UserMenu } from "./UserMenu";

// jsdom implements neither showModal nor close; toggle `open` as they do.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

let client: QueryClient;

function renderMenu() {
  return render(
    <QueryClientProvider client={client}>
      <UserMenu />
    </QueryClientProvider>
  );
}

// The closing menu still marks the rest of the page aria-hidden during its exit transition,
// so queries inside the confirm dialog pass `hidden: true`.
async function clickSignOut() {
  await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Sign Out" }));
}

beforeEach(() => {
  client = new QueryClient();
  client.setQueryData(["workspaces"], { workspaces: [] });
  m.navigate.mockReset();
  m.signOut.mockReset().mockResolvedValue({ data: { success: true }, error: null });
  m.pendingWriteCount.mockReset().mockReturnValue(0);
  m.wipeOfflineData.mockReset().mockResolvedValue(undefined);
  m.clearCachedSession.mockReset();
  m.install.installed = false;
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("UserMenu sign-out", () => {
  it("can't sign out offline, and says why", async () => {
    onlineManager.setOnline(false);
    renderMenu();

    await clickSignOut();

    const item = screen.getByRole("menuitem", { name: "Sign Out" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("title", SIGN_OUT_NEEDS_CONNECTION);
    expect(m.signOut).not.toHaveBeenCalled();
  });

  it("signs out, then deletes this device's data", async () => {
    renderMenu();

    await clickSignOut();

    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith("/login"));
    expect(m.signOut).toHaveBeenCalledOnce();
    expect(m.wipeOfflineData).toHaveBeenCalledWith("u1");
    expect(m.clearCachedSession).toHaveBeenCalledOnce();
    expect(client.getQueryData(["workspaces"])).toBeUndefined();
    expect(m.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      m.wipeOfflineData.mock.invocationCallOrder[0]
    );
  });

  it("asks before deleting unsynced changes, and signs out only on confirm", async () => {
    m.pendingWriteCount.mockReturnValue(3);
    renderMenu();

    await clickSignOut();

    const dialog = screen.getByText(/3 changes haven't synced yet/).closest("dialog");
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveTextContent("Signing out deletes them from this device.");
    expect(m.signOut).not.toHaveBeenCalled();

    await userEvent.click(
      within(dialog!).getByRole("button", { name: "Sign out anyway", hidden: true })
    );

    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith("/login"));
    expect(m.wipeOfflineData).toHaveBeenCalledWith("u1");
  });

  it("keeps unsynced changes when the person cancels", async () => {
    m.pendingWriteCount.mockReturnValue(1);
    renderMenu();

    await clickSignOut();
    const dialog = screen.getByText(/1 change hasn't synced yet/).closest("dialog");
    await userEvent.click(within(dialog!).getByRole("button", { name: "Cancel", hidden: true }));

    expect(m.signOut).not.toHaveBeenCalled();
    expect(m.wipeOfflineData).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the server refuses",
      () => m.signOut.mockResolvedValue({ data: null, error: { status: 500 } }),
    ],
    ["the request fails", () => m.signOut.mockRejectedValue(new Error("network"))],
  ])("keeps everything when %s", async (_name, arrange) => {
    arrange();
    renderMenu();

    await clickSignOut();

    await waitFor(() => expect(m.signOut).toHaveBeenCalledOnce());
    expect(m.wipeOfflineData).not.toHaveBeenCalled();
    expect(m.clearCachedSession).not.toHaveBeenCalled();
    expect(client.getQueryData(["workspaces"])).toEqual({ workspaces: [] });
    expect(m.navigate).not.toHaveBeenCalled();
  });
});

describe("UserMenu install", () => {
  it("offers installing, and shows the manual steps outside the menu", async () => {
    renderMenu();

    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Install app" }));

    const dialog = screen.getByText("Install Cadence").closest("dialog");
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveTextContent("Choose Install.");
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "Sign Out", hidden: true })
      ).not.toBeInTheDocument()
    );
    expect(dialog).toBeInTheDocument();
  });

  it("drops the item once installed and keeps Sign Out working", async () => {
    m.install.installed = true;
    renderMenu();

    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.queryByRole("menuitem", { name: "Install app" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "Sign Out" }));
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith("/login"));
  });
});
