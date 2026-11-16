#!/usr/bin/env node
// docs/openapi.json is generated from the Go route table and types (cmd/openapi); never edit it by hand.
// Without flags this verifies that both generated files are current; --write regenerates them.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'deployables/portal/web/package.json'));
const { default: openapiTS, astToString } = require('openapi-typescript');
const specPath = path.join(root, 'docs/openapi.json');
const target = path.join(root, 'deployables/portal/web/src/generated/api.d.ts');

const json = execFileSync('go', ['run', './cmd/openapi'], { cwd: path.join(root, 'deployables/portal/server'), encoding: 'utf8', maxBuffer: 1 << 26 });
const spec = JSON.parse(json);
const generated = astToString(await openapiTS(spec));
const routes = Object.values(spec.paths).reduce((n, methods) => n + Object.keys(methods).length, 0);

if (process.argv.includes('--write')) {
  await writeFile(specPath, json);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, generated);
  console.log(`Generated docs/openapi.json and deployables/portal/web/src/generated/api.d.ts (${routes} routes)`);
} else {
  const stale = [];
  if (await readFile(specPath, 'utf8').catch(() => '') !== json) stale.push('docs/openapi.json');
  if (await readFile(target, 'utf8').catch(() => '') !== generated) stale.push('api.d.ts');
  if (stale.length) throw new Error(`${stale.join(' and ')} stale. Run node scripts/check-contract.mjs --write`);
  console.log(`API contract verified: ${routes} routes; generated files are current.`);
}
