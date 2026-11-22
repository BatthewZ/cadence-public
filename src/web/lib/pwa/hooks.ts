import { useMemo, useSyncExternalStore } from "react";

import {
  currentInstallHelp,
  type InstallHelp,
  type InstallOutcome,
  installState,
  promptInstall,
} from "./install";
import { applyUpdate, dismissUpdate, updateReady } from "./sw";

export interface UpdatePrompt {
  /** A new version is installed and waiting. */
  ready: boolean;
  /** Activates it and reloads the page. Only ever call from a user action. */
  apply: () => void;
  /** Hides the prompt for this page load. */
  dismiss: () => void;
}

export function useUpdatePrompt(): UpdatePrompt {
  const ready = useSyncExternalStore(updateReady.subscribe, updateReady.get);
  return { ready, apply: applyUpdate, dismiss: dismissUpdate };
}

export interface Install {
  /** The browser's own install dialog can be shown (Chromium's `beforeinstallprompt`). */
  available: boolean;
  /** Running as an installed app, or just installed. Offer installing until this is true. */
  installed: boolean;
  /** Shows the browser's dialog; "unavailable" means show `help` instead. */
  install: () => Promise<InstallOutcome>;
  /** The manual route for this browser, for when there is no dialog. */
  help: InstallHelp;
}

export function useInstall(): Install {
  const { canPrompt, installed } = useSyncExternalStore(installState.subscribe, installState.get);
  const help = useMemo(() => currentInstallHelp(), []);
  return { available: canPrompt, installed, install: promptInstall, help };
}
