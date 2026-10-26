import { parse, type ParseOptions, type TokenType } from 'sugar-high/core';
import { tokenize as tokenizeTypeScript } from 'sugar-high/lang/typescript';

export interface CodeToken {
  readonly type: TokenType;
  readonly value: string;
}

export type CodeLine = readonly CodeToken[];

/** Just the TypeScript/TSX rules: importing sugar-high/lang would bundle all of its languages. */
const TYPESCRIPT: ParseOptions = { tokenize: tokenizeTypeScript };

/**
 * Tokenizes TS/TSX into lines of typed tokens, which CodeBlock renders as
 * React elements: no HTML strings, no dangerouslySetInnerHTML.
 */
export function tokenize(code: string): readonly CodeLine[] {
  return parse(code, TYPESCRIPT).lines.map((line) =>
    line.tokens.map((token) => ({ type: token.type, value: token.value })),
  );
}

const HIDDEN_REGION =
  /^[ \t]*\/\/ #region hidden\r?\n[\s\S]*?^[ \t]*\/\/ #endregion\r?\n/gm;

/**
 * The samples in src/examples are real modules, type-checked against the
 * published package. Lines that only exist to make a sample compile (its
 * imports of stand-in data and components) sit between
 * `// #region hidden` and `// #endregion`, and are dropped for display.
 */
export function displaySource(source: string): string {
  return source.replace(HIDDEN_REGION, '').trim();
}
