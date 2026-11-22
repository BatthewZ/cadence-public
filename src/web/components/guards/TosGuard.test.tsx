import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/web/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/web/lib/api/client")>()),
  api: { get: api.get },
}));

vi.mock("react-router-dom", () => ({
  Navigate: ({ to }: { to: string }) => <div>redirect:{to}</div>,
}));

import { OfflineError } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

import { TosGuard } from "./TosGuard";

function renderGuard(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <TosGuard>
        <div>app</div>
      </TosGuard>
    </QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  api.get.mockReset();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("TosGuard offline", () => {
  it("explains it can't load instead of spinning when the status was never loaded here", () => {
    onlineManager.setOnline(false);
    renderGuard(newClient());

    expect(screen.getByText("You’re offline")).toBeInTheDocument();
    expect(screen.queryByText("app")).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("doesn't report a failed check when the request never reached the server", async () => {
    api.get.mockRejectedValue(new OfflineError());
    renderGuard(newClient());

    expect(await screen.findByText("You’re offline")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to check Terms of Service status/)).not.toBeInTheDocument();
  });

  it("renders the app from the saved status while offline", () => {
    onlineManager.setOnline(false);
    const client = newClient();
    client.setQueryData(queryKeys.legal.tosStatus, { accepted: true, currentVersion: "1" });
    renderGuard(client);

    expect(screen.getByText("app")).toBeInTheDocument();
  });
});
