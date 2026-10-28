// Runs the packed-package smoke tests inside a directory that has the
// React version under test installed.
//
//   node scripts/run-smoke.mjs compat/react18
//   node scripts/run-smoke.mjs compat/react18 --conditions=production
//
// The scripts have to execute from inside that directory: Node resolves
// `react` by walking up from the *script's* own path, so running
// compat/smoke.mjs in place would quietly pick up the repository's own
// React instead of the pinned one, and the check would pass without ever
// testing what it claims to.
import { execFileSync } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , targetDirectory, ...nodeFlags] = process.argv;
if (targetDirectory === undefined) {
  console.error('usage: node scripts/run-smoke.mjs <directory> [node flags]');
  process.exit(1);
}

const root = process.cwd();
const target = resolve(root, targetDirectory);
const copied = ['smoke.mjs', 'smoke.cjs'].map((name) => {
  const destination = join(target, name);
  copyFileSync(join(root, 'compat', name), destination);
  return destination;
});

/** A leaked handle shows up as a script that finishes its work and never exits. */
const TIMEOUT_MS = 60_000;

try {
  for (const script of copied) {
    execFileSync(process.execPath, [...nodeFlags, script], {
      cwd: target,
      stdio: 'inherit',
      timeout: TIMEOUT_MS,
    });
  }
} finally {
  for (const script of copied) rmSync(script, { force: true });
}
