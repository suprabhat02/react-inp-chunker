import { readStored, writeStored } from './storage.ts';

export type Theme = 'light' | 'dark';

/** Same key the inline script in index.html reads before first paint. */
export const THEME_STORAGE_KEY = 'react-inp-chunker:theme';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** The theme currently applied to <html>, as set by the inline boot script. */
export function getAppliedTheme(): Theme {
  const applied = document.documentElement.dataset['theme'];
  if (isTheme(applied)) return applied;
  const stored = readStored(THEME_STORAGE_KEY);
  if (isTheme(stored)) return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  writeStored(THEME_STORAGE_KEY, theme);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'light' ? '#f7fafe' : '#020c19');
}
