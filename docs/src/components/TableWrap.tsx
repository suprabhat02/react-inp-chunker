import type { ReactNode } from 'react';

/**
 * A table that may scroll sideways on narrow screens. Focusable and named,
 * so keyboard users can reach it and scroll it with the arrow keys.
 */
export function TableWrap({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
