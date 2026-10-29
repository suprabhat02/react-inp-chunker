// Checks that every entry point of this package resolves to the right types
// under every module-resolution mode a consumer might use — the "Are the
// types wrong?" checks, run against exactly the files `npm publish` would
// upload.
//
// It drives @arethetypeswrong/core directly rather than its CLI: the CLI
// unpacks a tarball through a streaming gunzip that keeps only the last
// chunk (fflate workaround in createPackage.js), which silently breaks for
// tarballs larger than one chunk — including this one. Reading the packed
// file list from disk avoids the question entirely and checks the same
// bytes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Package, checkPackage } from '@arethetypeswrong/core';
import { filterProblems, problemKindInfo } from '@arethetypeswrong/core/problems';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** The exact file list `npm publish` would send, straight from npm. */
function publishedFiles() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(output);
  // npm <11 printed an array (`[{...}]`); npm 11+ prints an object keyed by
  // package name (`{"react-inp-chunker": {...}}`) for the same `--json`
  // flag. Reading whichever shape comes back keeps this working across the
  // npm major this repo's own toolchain uses (npm ci) and the newer one CI
  // installs just for publish (`npm install -g npm@latest`, for Trusted
  // Publishing) — the two have disagreed on this before and may again.
  const report = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  return report.files.map((file) => file.path);
}

const files = {};
for (const path of publishedFiles()) {
  files[`/node_modules/${manifest.name}/${path}`] = readFileSync(join(root, path));
}

const result = await checkPackage(new Package(files, manifest.name, manifest.version));

const problems = filterProblems(result, {});
if (problems.length === 0) {
  const entrypoints = Object.keys(result.entrypoints ?? {}).join(', ');
  console.log(`✓ Types resolve correctly for every entry point (${entrypoints})`);
  process.exit(0);
}

console.error('✗ Type resolution problems:\n');
for (const problem of problems) {
  const info = problemKindInfo[problem.kind];
  const where = [problem.entrypoint, problem.resolutionKind].filter(Boolean).join(' / ');
  console.error(
    `  ${info?.emoji ?? '•'} ${info?.shortDescription ?? problem.kind}${where ? ` — ${where}` : ''}`,
  );
  if (info?.description) console.error(`      ${info.description}`);
}
process.exit(1);
