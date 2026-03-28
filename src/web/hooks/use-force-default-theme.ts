import { useEffect } from "react";

/**
 * Forces the default (Minimal) theme while the component is mounted by removing
 * the `data-theme` attribute from the document element. Restores the previous
 * theme on unmount so workspace pages transition smoothly.
 *
 * Does not touch localStorage — the cached theme remains available for the FOUC
 * prevention script on authenticated page loads.
 */
export function useForceDefaultTheme() {
  useEffect(() => {
    const previous = document.documentElement.getAttribute("data-theme");
    if (previous) {
      document.documentElement.removeAttribute("data-theme");
    }
    return () => {
      if (previous) {
        document.documentElement.setAttribute("data-theme", previous);
      }
    };
  }, []);
}
