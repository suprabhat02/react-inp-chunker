import { memo, useMemo } from 'react';

import { tokenize } from '../lib/highlight.ts';
import { CopyButton } from './CopyButton.tsx';

import './code-block.css';

interface CodeBlockProps {
  readonly code: string;
  /** Shown above the code: a file name, or what the snippet is. */
  readonly title?: string;
  /** Completes the copy button's accessible name; defaults to the title. */
  readonly copyLabel?: string;
}

/** Memoized: the playground re-renders on every slice of a run, and its code doesn't change. */
export const CodeBlock = memo(function CodeBlock({
  code,
  title,
  copyLabel,
}: CodeBlockProps) {
  const lines = useMemo(() => tokenize(code), [code]);
  const label = copyLabel ?? title ?? 'code';

  return (
    <div className="code-block">
      <div className="code-block__bar">
        {title !== undefined ? (
          <span className="code-block__title">{title}</span>
        ) : (
          <span />
        )}
        <CopyButton text={code} label={label} />
      </div>
      {/* Focusable so keyboard users can scroll long lines sideways. */}
      <pre className="code-block__pre" tabIndex={0}>
        <code>
          {lines.map((line, lineIndex) => (
            <span className="code-block__line" key={lineIndex}>
              {line.map((token, tokenIndex) =>
                token.type === 'space' || token.type === 'break' ? (
                  token.value
                ) : (
                  <span className={`tok-${token.type}`} key={tokenIndex}>
                    {token.value}
                  </span>
                ),
              )}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
});
