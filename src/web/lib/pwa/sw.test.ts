import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = () => void;

const fake = vi.hoisted(() => ({
  /** What `register()` resolves with; null = it rejects (a private window). */
  registration: null as ServiceWorkerRegistration | null,
  instances: [] as {
    listeners: Map<string, Listener[]>;
    messageSkipWaiting: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    emit: (type: string) => void;
  }[],
}));

vi.mock("workbox-window", () => ({
  Workbox: class {
    listeners = new Map<string, Listener[]>();
    messageSkipWaiting = vi.fn();
    update = vi.fn(() => Promise.resolve(undefined));
    constructor() {
      fake.instances.push(this);
    }
    addEventListener(type: string, l: Listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
    }
    emit(type: string) {
      for (const l of this.listeners.get(type) ?? []) l();
    }
    register() {
      return fake.registration
        ? Promise.resolve(fake.registration)
        : Promise.reject(new Error("private window"));
    }
  },
}));

const reload = vi.fn();
const warn = vi.fn();

beforeEach(() => {
  vi.resetModules();
  warn.mockReset();
  vi.spyOn(console, "warn").mockImplementation(warn);
  fake.instances.length = 0;
  fake.registration = null;
  reload.mockReset();
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
  vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

/** A registration whose deploys are driven by hand: `deploy()` installs a worker that waits. */
class FakeRegistration extends EventTarget {
  active: object | null = {};
  installing: (EventTarget & { state: string }) | null = null;
  waiting: object | null = null;
  async deploy() {
    const sw = Object.assign(new EventTarget(), { state: "installing" });
    this.installing = sw;
    this.dispatchEvent(new Event("updatefound"));
    sw.state = "installed";
    this.installing = null;
    this.waiting = sw;
    sw.dispatchEvent(new Event("statechange"));
    await Promise.resolve();
  }
}

describe("service worker update", () => {
  it("prompts for every deploy in a long-lived tab, not just the first one workbox reports", async () => {
    const reg = new FakeRegistration();
    fake.registration = reg as unknown as ServiceWorkerRegistration;
    const sw = await import("./sw");
    sw.registerServiceWorker();
    await vi.waitFor(() => expect(sw.updateReady.get()).toBe(false));
    await Promise.resolve();
    // Workbox reports the first deploy, then stops listening for `updatefound`.
    await reg.deploy();
    fake.instances[0].emit("waiting");
    expect(sw.updateReady.get()).toBe(true);
    sw.dismissUpdate();
    await reg.deploy();
    expect(sw.updateReady.get()).toBe(true);
    sw.dismissUpdate();
    await reg.deploy();
    expect(sw.updateReady.get()).toBe(true);
  });

  it("a first install (nothing active yet) is not an update", async () => {
    const reg = new FakeRegistration();
    reg.active = null;
    fake.registration = reg as unknown as ServiceWorkerRegistration;
    const sw = await import("./sw");
    sw.registerServiceWorker();
    await Promise.resolve();
    await reg.deploy();
    expect(sw.updateReady.get()).toBe(false);
  });

  it("registers once, flags a waiting worker, and reloads only after it takes control", async () => {
    const sw = await import("./sw");
    sw.registerServiceWorker();
    sw.registerServiceWorker();
    expect(fake.instances).toHaveLength(1);
    const wb = fake.instances[0];
    const seen: boolean[] = [];
    sw.updateReady.subscribe(() => seen.push(sw.updateReady.get()));
    expect(sw.updateReady.get()).toBe(false);
    wb.emit("waiting");
    expect(seen).toEqual([true]);
    sw.applyUpdate();
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    wb.emit("controlling");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("another tab already applied the update (clientsClaim): Reload only reloads", async () => {
    const sw = await import("./sw");
    sw.registerServiceWorker();
    const wb = fake.instances[0];
    wb.emit("waiting");
    wb.emit("controlling"); // the other tab's skipWaiting handed this page over
    sw.applyUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
  });

  it("a worker waiting after a takeover messages again; dismiss hides the prompt", async () => {
    const sw = await import("./sw");
    sw.registerServiceWorker();
    const wb = fake.instances[0];
    wb.emit("controlling"); // first visit: clientsClaim takes the page
    wb.emit("waiting"); // later, a new version waits
    sw.applyUpdate();
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    sw.dismissUpdate();
    expect(sw.updateReady.get()).toBe(false);
  });

  it("a refused registration (private window) is reported, not thrown", async () => {
    const sw = await import("./sw");
    sw.registerServiceWorker();
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith("Service worker registration failed", expect.any(Error))
    );
    expect(sw.updateReady.get()).toBe(false);
  });

  it("checks hourly and when the tab becomes visible; no worker support = no-op", async () => {
    vi.useFakeTimers();
    const sw = await import("./sw");
    sw.registerServiceWorker();
    const wb = fake.instances[0];
    vi.advanceTimersByTime(sw.UPDATE_CHECK_MS);
    expect(wb.update).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(wb.update).toHaveBeenCalledTimes(2);

    vi.resetModules();
    Reflect.deleteProperty(navigator, "serviceWorker");
    const bare = await import("./sw");
    bare.registerServiceWorker();
    bare.applyUpdate();
    expect(fake.instances).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
