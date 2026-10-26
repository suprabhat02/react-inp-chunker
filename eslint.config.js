// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Architectural boundary: core/ is the framework-agnostic scheduling engine.
 * react/ is the only layer allowed to import React. core/ must never import
 * react or react-dom — that's what keeps the scheduler reusable outside React
 * and keeps its bundle size honest. The rule set is the contract; CI fails
 * the build if it's crossed.
 */
/** @returns {import('eslint').Linter.RulesRecord} */
const forbid = (/** @type {string[]} */ groups, /** @type {string} */ message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: groups, message }] }],
});

export default defineConfig(
  {
    ignores: ['dist/', 'coverage/', 'node_modules/'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // A yield/scheduling bug that only shows up under load is exactly the
      // kind of thing a floating, unawaited promise hides. Never allow one.
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['src/core/**'],
    rules: forbid(
      ['react', 'react-dom', 'react/*'],
      'core/ must stay framework-free — it is the part that works outside React too.',
    ),
  },
  {
    files: ['src/react/**'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
