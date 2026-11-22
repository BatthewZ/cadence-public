import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("./sw");
  vi.resetModules();
});

async function bootWith(registerWorker: boolean) {
  const register = vi.fn();
  vi.doMock("./sw", async (orig) => ({
    ...(await orig<typeof import("./sw")>()),
    registerServiceWorker: register,
  }));
  const { bootPwa } = await import("./index");
  const install = await import("./install");
  bootPwa({ registerWorker });
  return { register, install };
}

describe("bootPwa", () => {
  it("captures the install prompt before anything renders", async () => {
    const { install } = await bootWith(false);
    window.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: () => Promise.resolve(),
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      })
    );
    expect(install.installState.get().canPrompt).toBe(true);
  });

  it("registers the service worker only when asked (production builds)", async () => {
    expect((await bootWith(false)).register).not.toHaveBeenCalled();
    vi.resetModules();
    expect((await bootWith(true)).register).toHaveBeenCalledTimes(1);
  });
});
