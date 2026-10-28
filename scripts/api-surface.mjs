// Prints the package's public API as a stable, reviewable list: every
// exported name from every entry point, with its kind and its type text.
//
// `npm run api:check` compares this against api-surface.txt, so no change
// to the published types can land without showing up in a diff and in a
// review. `npm run api:update` rewrites the file on purpose.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

const root = process.cwd();
const ENTRY_POINTS = [
  ['react-inp-chunker', 'dist/index.d.ts'],
  ['react-inp-chunker/core', 'dist/core/index.d.ts'],
];

/**
 * Collapses a declaration to one line and drops its doc comments: the
 * shape is the contract, prose about it is not, and a reworded comment
 * should not read as an API change.
 */
const oneLine = (text) =>
  text
    .replace(/\/\*\*[\s\S]*?\*\//gu, ' ')
    .replace(/\/\/[^\n]*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

function surfaceOf(entryName, declarationFile) {
  const program = ts.createProgram([join(root, declarationFile)], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(join(root, declarationFile));
  if (source === undefined) throw new Error(`Could not read ${declarationFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) throw new Error(`${declarationFile} exports nothing`);

  const lines = [];
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declaration = resolved.declarations?.[0];
    if (declaration === undefined) continue;

    const isType =
      resolved.flags &
      (ts.SymbolFlags.Interface |
        ts.SymbolFlags.TypeAlias |
        ts.SymbolFlags.TypeParameter);
    if (isType) {
      // Interface and type shapes are part of the contract, so a changed
      // field shows up here.
      const text = declaration.getText(declaration.getSourceFile());
      lines.push(`type ${symbol.name}: ${oneLine(text)}`);
      continue;
    }
    const type = checker.getTypeOfSymbolAtLocation(resolved, declaration);
    lines.push(`value ${symbol.name}: ${oneLine(checker.typeToString(type))}`);
  }
  return [`# ${entryName}`, ...lines.sort((a, b) => a.localeCompare(b)), ''];
}

const surface = ENTRY_POINTS.flatMap(([name, file]) => surfaceOf(name, file)).join('\n');
const goldenPath = join(root, 'api-surface.txt');

if (process.argv.includes('--update')) {
  writeFileSync(goldenPath, surface);
  console.log(`✓ Wrote ${goldenPath}`);
  process.exit(0);
}

let golden;
try {
  golden = readFileSync(goldenPath, 'utf8');
} catch {
  console.error(
    `✗ ${goldenPath} is missing. Run \`npm run api:update\` and review the result.`,
  );
  process.exit(1);
}

if (golden === surface) {
  console.log(
    `✓ Public API matches api-surface.txt (${surface.split('\n').filter((l) => l && !l.startsWith('#')).length} exports)`,
  );
  process.exit(0);
}

console.error('✗ The public API changed.\n');
const goldenLines = golden.split('\n');
const currentLines = surface.split('\n');
for (const line of goldenLines) {
  if (line !== '' && !currentLines.includes(line)) console.error(`  removed: ${line}`);
}
for (const line of currentLines) {
  if (line !== '' && !goldenLines.includes(line)) console.error(`  added:   ${line}`);
}
console.error(
  '\nIf this is intended, run `npm run api:update` and include the diff in the pull request.',
);
process.exit(1);
