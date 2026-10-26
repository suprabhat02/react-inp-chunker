/**
 * localStorage that never throws. Private windows, blocked site data and
 * sandboxed previews can all make the accessor itself throw; every caller
 * here treats a stored value as a convenience, never as required state.
 */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not persisted; the in-page state still applies.
  }
}
