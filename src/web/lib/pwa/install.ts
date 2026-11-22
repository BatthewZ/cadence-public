import { type ExternalValue, observable } from "./observable";

export interface InstallState {
  /** The browser offered installation (`beforeinstallprompt`) and we hold the event. */
  canPrompt: boolean;
  /** Running as an installed app, or just installed. */
  installed: boolean;
}

/** The manual install route for one browser, shown when it offers no dialog. */
export interface InstallHelp {
  title: string;
  steps: string[];
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/** Chromium's install event; not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true || window.matchMedia?.("(display-mode: standalone)")?.matches === true
  );
}

let deferred: BeforeInstallPromptEvent | null = null;
const state = observable<InstallState>({ canPrompt: false, installed: false });
export const installState: ExternalValue<InstallState> = state;
let capturing = false;

/**
 * Starts listening for `beforeinstallprompt` / `appinstalled`, once. Run before React renders:
 * Chromium can fire the event before any "Install app" control has mounted.
 */
export function captureInstallPrompt(): void {
  if (capturing || typeof window === "undefined") return;
  capturing = true;
  state.set({ canPrompt: false, installed: isStandalone() });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // no mini-infobar; the app's own "Install app" offers it
    deferred = e as BeforeInstallPromptEvent;
    state.set({ canPrompt: true, installed: false });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    state.set({ canPrompt: false, installed: true });
  });
}

/** Shows the browser's install dialog. The event is single-use either way. */
export async function promptInstall(): Promise<InstallOutcome> {
  const e = deferred;
  if (!e) return "unavailable";
  deferred = null;
  state.set({ ...state.get(), canPrompt: false });
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === "accepted") state.set({ canPrompt: false, installed: true });
    return outcome;
  } catch {
    // A stale event (the browser already used it) throws; the caller shows the manual route.
    return "unavailable";
  }
}

const IOS_DEVICE = /iPad|iPhone|iPod/;
const OTHER_IOS_BROWSER = /CriOS|FxiOS|EdgiOS/;

/** iOS, or iPadOS, which reports "Macintosh" and is told apart from a Mac by its touch points. */
function isIos(ua: string, touchPoints: number): boolean {
  return IOS_DEVICE.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/** iOS Safari never fires `beforeinstallprompt`; installing is Share → Add to Home Screen. */
export function isIosSafari(ua: string, touchPoints: number): boolean {
  return isIos(ua, touchPoints) && /Safari/.test(ua) && !OTHER_IOS_BROWSER.test(ua);
}

/**
 * What to tell someone who taps "Install app" when the browser offered no dialog: the manual
 * route for their browser, or why it can't work here (an insecure origin, e.g. a phone on a
 * laptop's LAN dev server).
 */
export function installHelp(env: {
  ua: string;
  secure: boolean;
  touchPoints: number;
}): InstallHelp {
  const { ua, secure, touchPoints } = env;
  const iOS = isIos(ua, touchPoints);
  if (!secure) {
    return {
      title: "Install from the live site",
      steps: [
        "Installing needs a secure (https) address, and this one isn't.",
        "Open Cadence at its https:// address on this device, then choose Install app again.",
      ],
    };
  }
  // Chrome, Firefox and Edge on iOS, and in-app browsers (WKWebViews with no Safari token):
  // only Safari can add to the Home Screen.
  if (iOS && !isIosSafari(ua, touchPoints)) {
    return {
      title: "Install with Safari",
      steps: ["Open this page in Safari.", "Tap Share, then Add to Home Screen."],
    };
  }
  if (iOS) {
    return { title: "Add to Home Screen", steps: ["Tap Share.", "Choose Add to Home Screen."] };
  }
  if (/Android/.test(ua) && /Firefox/.test(ua)) {
    return {
      title: "Install from the menu",
      steps: ["Open the browser menu (⋮).", "Choose Install."],
    };
  }
  if (/Android/.test(ua)) {
    return {
      title: "Install from the menu",
      steps: ["Open the browser menu (⋮).", "Choose Install app (or Add to Home screen)."],
    };
  }
  if (/Firefox/.test(ua)) {
    return {
      title: "Not supported in Firefox",
      steps: ["Firefox on desktop can't install web apps.", "Use Chrome, Edge or Safari instead."],
    };
  }
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) {
    return { title: "Add to Dock", steps: ["In the menu bar choose File.", "Choose Add to Dock."] };
  }
  return {
    title: "Install from the browser",
    steps: [
      "Click the install icon at the right end of the address bar.",
      "No icon? Open the browser menu and choose Install (in Chrome, under Cast, save and share).",
    ],
  };
}

/** `installHelp` for this browser. */
export function currentInstallHelp(): InstallHelp {
  return installHelp({
    ua: navigator.userAgent,
    secure: window.isSecureContext,
    touchPoints: navigator.maxTouchPoints,
  });
}
