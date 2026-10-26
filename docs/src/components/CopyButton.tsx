import { useCopy } from 'react-smart-copy';

import './copy-button.css';

interface CopyButtonProps {
  /** The exact text to put on the clipboard. */
  readonly text: string;
  /** What is being copied, completing the accessible name: "Copy" + "install command". */
  readonly label: string;
}

const STATUS_TEXT = {
  idle: 'Copy',
  copying: 'Copying',
  copied: 'Copied',
  error: 'Copy failed',
} as const;

/**
 * Copy buttons on this site run on react-smart-copy, the author's other
 * library: its useCopy hook supplies the status (copying, copied, error),
 * and a polite live region announces the outcome.
 */
export function CopyButton({ text, label }: CopyButtonProps) {
  const { copy, status } = useCopy({ resetAfterMs: 1800 });

  return (
    <>
      <button
        type="button"
        className="copy-button"
        data-status={status}
        onClick={() => {
          void copy(text);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
          {status === 'copied' ? (
            <path
              d="M3 8.5 6.5 12 13 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          ) : (
            <>
              <rect
                x="5.5"
                y="5.5"
                width="8"
                height="8"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </>
          )}
        </svg>
        <span>{STATUS_TEXT[status]}</span>
        <span className="visually-hidden"> {label}</span>
      </button>
      <span className="visually-hidden" role="status">
        {status === 'copied' ? `Copied ${label} to the clipboard.` : ''}
        {status === 'error'
          ? `Couldn't copy the ${label}. Select it and copy it manually.`
          : ''}
      </span>
    </>
  );
}
