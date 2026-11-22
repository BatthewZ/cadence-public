import { describe, expect, it } from "vitest";

import { installHelp } from "./install";

const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
  iosFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15",
  /** Facebook's in-app browser: a WKWebView with no Safari token (and no Add to Home Screen). */
  iosFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 15; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  desktopFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
};
const help = (ua: string, secure = true, touchPoints = 0) =>
  installHelp({ ua, secure, touchPoints });

describe("installHelp: the manual install route per browser", () => {
  it.each([
    ["iosSafari", "Add to Home Screen", 5],
    ["iosChrome", "Install with Safari", 5],
    ["iosFirefox", "Install with Safari", 5],
    ["iosFacebook", "Install with Safari", 5],
    ["androidChrome", "Install from the menu", 5],
    ["androidFirefox", "Install from the menu", 5],
    ["macSafari", "Add to Dock", 0],
    ["desktopFirefox", "Not supported in Firefox", 0],
    ["desktopChrome", "Install from the browser", 0],
  ] as const)("%s → %s", (k, title, touch) => {
    expect(help(UA[k], true, touch).title).toBe(title);
  });

  it("iOS Safari's steps name Share → Add to Home Screen; other iOS browsers say open Safari", () => {
    expect(help(UA.iosSafari, true, 5).steps.join(" ")).toMatch(/Share.*Add to Home Screen/);
    expect(help(UA.iosChrome, true, 5).steps[0]).toBe("Open this page in Safari.");
  });

  it("an iPad reporting a Mac user agent is treated as iOS", () => {
    expect(help(UA.macSafari, true, 5).title).toBe("Add to Home Screen");
  });

  it("an insecure origin (phone on a laptop's LAN dev server) explains why, whatever the browser", () => {
    for (const ua of Object.values(UA)) {
      const h = help(ua, false, 5);
      expect(h.title).toBe("Install from the live site");
      expect(h.steps[0]).toMatch(/secure \(https\)/);
    }
  });
});
