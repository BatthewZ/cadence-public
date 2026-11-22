import { captureInstallPrompt } from "./install";
import { registerServiceWorker } from "./sw";

/** Runs before React renders, so an early `beforeinstallprompt` is not missed. */
export function bootPwa({ registerWorker }: { registerWorker: boolean }): void {
  captureInstallPrompt();
  if (registerWorker) registerServiceWorker();
}

export { type Install, type UpdatePrompt, useInstall, useUpdatePrompt } from "./hooks";
export type { InstallHelp, InstallOutcome } from "./install";
export { requestPersistentStorage } from "./persist";
