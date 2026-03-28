import { useEffect, useRef, useState } from "react";

/**
 * Tracks which section is currently visible using IntersectionObserver.
 * Returns the ID of the first visible section in document order.
 */
export function useActiveSection(sectionIds: string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  const visibleSet = useRef(new Set<string>());

  useEffect(() => {
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    visibleSet.current.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleSet.current.add(entry.target.id);
          } else {
            visibleSet.current.delete(entry.target.id);
          }
        }

        // Pick the first visible section in document order
        for (const id of sectionIds) {
          if (visibleSet.current.has(id)) {
            setActiveId(id);
            return;
          }
        }
      },
      { rootMargin: "-80px 0px -40% 0px" },
    );

    for (const el of elements) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sectionIds]);

  return activeId;
}
