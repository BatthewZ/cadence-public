import { useEffect } from "react";

export const BASE_TITLE = "Cadence";

/**
 * Sets the document title while the component is mounted.
 * Restores the base title on unmount.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} | ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
