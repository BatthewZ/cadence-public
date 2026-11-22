import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

function installEvent(outcome: "accepted" | "dismissed", prompt = vi.fn(() => Promise.resolve())) {
  return Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
}

describe("install prompt", () => {
  it("holds the event: captured → canPrompt, prompt() is single-use, appinstalled → installed", async () => {
    const install = await import("./install");
    install.captureInstallPrompt();
    expect(install.installState.get()).toEqual({ canPrompt: false, installed: false });
    expect(await install.promptInstall()).toBe("unavailable");

    const prompt = vi.fn(() => Promise.resolve());
    const event = installEvent("dismissed", prompt);
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); // no mini-infobar
    expect(install.installState.get()).toEqual({ canPrompt: true, installed: false });

    expect(await install.promptInstall()).toBe("dismissed");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(install.installState.get().canPrompt).toBe(false);
    expect(await install.promptInstall()).toBe("unavailable");

    window.dispatchEvent(new Event("appinstalled"));
    expect(install.installState.get()).toEqual({ canPrompt: false, installed: true });
  });

  it("an accepted prompt counts as installed; a stale event that throws reads as unavailable", async () => {
    const install = await import("./install");
    install.captureInstallPrompt();
    window.dispatchEvent(installEvent("accepted"));
    expect(await install.promptInstall()).toBe("accepted");
    expect(install.installState.get().installed).toBe(true);

    window.dispatchEvent(
      installEvent(
        "accepted",
        vi.fn(() => Promise.reject(new Error("used")))
      )
    );
    expect(await install.promptInstall()).toBe("unavailable");
  });

  it("counts a standalone launch as installed", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(display-mode: standalone)" }));
    const install = await import("./install");
    install.captureInstallPrompt();
    expect(install.installState.get().installed).toBe(true);
  });

  it("recognises iOS Safari (incl. iPadOS as Macintosh) but not Chrome / Firefox on iOS", async () => {
    const { isIosSafari } = await import("./install");
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1";
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15";
    expect(isIosSafari(iphone, 5)).toBe(true);
    expect(isIosSafari(ipad, 5)).toBe(true);
    expect(isIosSafari(ipad, 0)).toBe(false); // a real Mac
    expect(isIosSafari(iphone.replace("Version/18.0", "CriOS/131.0"), 5)).toBe(false);
    expect(isIosSafari(iphone.replace("Version/18.0", "FxiOS/133.0"), 5)).toBe(false);
  });
});
