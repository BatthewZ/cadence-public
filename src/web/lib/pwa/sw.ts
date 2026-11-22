import { Workbox } from "workbox-window";

import { type ExternalValue, observable } from "./observable";

const ready = observable(false);
/** A new version is installed and waiting for the person to tap "Reload". */
export const updateReady: ExternalValue<boolean> = ready;

let workbox: Workbox | null = null;
/** The waiting worker has since taken control of this page (another tab applied the update). */
let waitingTookOver = false;

/** How often an open tab asks for a new version (also on returning to the tab). */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

function markWaiting(): void {
  waitingTookOver = false;
  ready.set(true);
}

/**
 * Flags every later deploy for as long as the tab lives. workbox-window reports one new worker
 * per page load (after the first `updatefound`, or a minute after registering, it stops
 * listening), so a tab left open across two deploys would otherwise never prompt again.
 */
function watchDeploys(reg: ServiceWorkerRegistration): void {
  reg.addEventListener("updatefound", () => {
    const sw = reg.installing;
    sw?.addEventListener("statechange", () => {
      if (sw.state === "installed" && reg.active && reg.waiting === sw) markWaiting();
    });
  });
}

/**
 * Registers the generated `/sw.js`, once. Production builds only: the dev server has no worker,
 * and one left over from an earlier build would serve stale assets.
 */
export function registerServiceWorker(url = "/sw.js"): void {
  if (workbox || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const wb = new Workbox(url, { scope: "/" });
  workbox = wb;
  // Fires both for a worker installed now and one already waiting from an earlier visit.
  wb.addEventListener("waiting", markWaiting);
  wb.addEventListener("controlling", () => {
    waitingTookOver = true;
  });
  wb.register().then(
    (reg) => {
      if (reg) watchDeploys(reg);
    },
    (error: unknown) => {
      // Private windows and http origins refuse registration; the app still works online.
      console.warn("Service worker registration failed", error);
    }
  );
  const check = () => {
    wb.update().catch(() => undefined);
  };
  window.setInterval(check, UPDATE_CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
}

/**
 * Activates the waiting worker, then reloads once it controls the page. With `clientsClaim`,
 * another tab may already have activated it: then there is no waiting worker to message and
 * this only reloads.
 */
export function applyUpdate(): void {
  const wb = workbox;
  if (!wb) return;
  if (waitingTookOver) {
    window.location.reload();
    return;
  }
  wb.addEventListener("controlling", () => window.location.reload());
  wb.messageSkipWaiting();
}

/** "Not now": hides the prompt; the new version keeps waiting until every Cadence tab closes. */
export function dismissUpdate(): void {
  ready.set(false);
}
