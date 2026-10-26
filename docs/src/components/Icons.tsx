/** Brand glyphs, drawn inline so the page loads no icon font or sprite. */

export function GitHubIcon({ size = 20 }: { readonly size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width={size} height={size}>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

export function StarIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width={size} height={size}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="m8 1.6 1.98 4.02 4.44.64-3.21 3.13.76 4.42L8 11.72l-3.97 2.09.76-4.42L1.58 6.26l4.44-.64L8 1.6Z"
      />
    </svg>
  );
}

/** The mark: a task cut into slices, then an interaction getting through. */
export function ChunkMark({ size = 22 }: { readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="chunk-mark"
    >
      <rect
        x="1"
        y="7"
        width="5"
        height="10"
        rx="1.2"
        style={{ fill: 'var(--accent)' }}
      />
      <rect
        x="7.5"
        y="7"
        width="5"
        height="10"
        rx="1.2"
        style={{ fill: 'var(--accent)', opacity: 0.72 }}
      />
      <rect
        x="14"
        y="7"
        width="5"
        height="10"
        rx="1.2"
        style={{ fill: 'var(--accent)', opacity: 0.45 }}
      />
      <rect
        x="20.5"
        y="4"
        width="2.5"
        height="16"
        rx="1.25"
        style={{ fill: 'var(--accent-2)' }}
      />
    </svg>
  );
}
