import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => Reflect.deleteProperty(navigator, "storage"));

function stubStorage(storage: Partial<StorageManager>) {
  Object.defineProperty(navigator, "storage", { value: storage, configurable: true });
}

describe("requestPersistentStorage", () => {
  it("asks once per load, without any localStorage flag", async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stubStorage({ persist, persisted: () => Promise.resolve(false) });
    const before = localStorage.length;
    const { requestPersistentStorage } = await import("./persist");
    expect(await requestPersistentStorage()).toBe(true);
    expect(await requestPersistentStorage()).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(before);
  });

  it("already persisted: doesn't ask; unsupported or throwing: null", async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stubStorage({ persist, persisted: () => Promise.resolve(true) });
    expect(await (await import("./persist")).requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();

    vi.resetModules();
    stubStorage({});
    expect(await (await import("./persist")).requestPersistentStorage()).toBeNull();

    vi.resetModules();
    stubStorage({ persist: () => Promise.reject(new Error("denied")) });
    expect(await (await import("./persist")).requestPersistentStorage()).toBeNull();
  });
});
