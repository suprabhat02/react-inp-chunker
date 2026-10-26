import { version } from 'react';
import { describe, expect, it } from 'vitest';

/**
 * Guards the React 18 compatibility run: with REACT_VERSION=18, every react
 * import is aliased to compat/react18 (see vitest.config.ts). If that alias
 * ever silently stopped applying, the "React 18" job would quietly test
 * React 19 again — this makes that a failure instead.
 */
describe('test runtime', () => {
  it('runs on the React major asked for in REACT_VERSION (default: 19, the dev dependency)', () => {
    const expectedMajor = process.env['REACT_VERSION'] ?? '19';
    expect(version.split('.')[0]).toBe(expectedMajor);
  });
});
