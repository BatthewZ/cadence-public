import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workboxes = vi.hoisted(() => [] as { emit: (type: string) => void }[]);

vi.mock("workbox-window", () => ({
  Workbox: class {
    listeners = new Map<string, (() => void)[]>();
    constructor() {
      workboxes.push(this);
    }
    addEventListener(type: string, l: () => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
    }
    emit(type: string) {
      for (const l of this.listeners.get(type) ?? []) l();
    }
    register() {
      return Promise.resolve(undefined);
    }
    update() {
      return Promise.resolve(undefined);
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  workboxes.length = 0;
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(navigator, "userAgent");
});

describe("useUpdatePrompt", () => {
  it("re-renders when a new version waits, and dismiss hides it", async () => {
    const { useUpdatePrompt } = await import("./hooks");
    const { registerServiceWorker } = await import("./sw");
    registerServiceWorker();
    const { result } = renderHook(() => useUpdatePrompt());
    expect(result.current.ready).toBe(false);

    act(() => workboxes[0].emit("waiting"));
    expect(result.current.ready).toBe(true);

    act(() => result.current.dismiss());
    expect(result.current.ready).toBe(false);
  });
});

describe("useInstall", () => {
  it("tracks the captured prompt and installed state, with this browser's help", async () => {
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    vi.stubGlobal("isSecureContext", true);
    const { useInstall } = await import("./hooks");
    const { captureInstallPrompt } = await import("./install");
    captureInstallPrompt();
    const { result } = renderHook(() => useInstall());
    expect(result.current).toMatchObject({ available: false, installed: false });
    expect(result.current.help.title).toBe("Add to Home Screen");

    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: () => Promise.resolve(),
          userChoice: Promise.resolve({ outcome: "accepted" }),
        })
      );
    });
    expect(result.current.available).toBe(true);

    await act(async () => {
      expect(await result.current.install()).toBe("accepted");
    });
    expect(result.current).toMatchObject({ available: false, installed: true });
  });
});
