import { useEffect, useState } from 'react';

/**
 * The id of the section currently being read, for marking the matching
 * header link with aria-current. A section counts as "being read" once its
 * top has scrolled past the upper third of the viewport.
 */
export function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // The first section, in document order, that is in the band.
        const current = ids.find((id) => visible.has(id)) ?? null;
        setActive(current);
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );

    for (const section of sections) observer.observe(section);
    return () => {
      observer.disconnect();
    };
  }, [ids]);

  return active;
}
