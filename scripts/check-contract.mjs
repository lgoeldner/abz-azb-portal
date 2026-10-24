#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'deployables/portal/web/package.json'));
const { default: openapiTS, astToString } = require('openapi-typescript');
const spec = JSON.parse(await readFile(path.join(root, 'docs/openapi.json'), 'utf8'));
const target = path.join(root, 'deployables/portal/web/src/generated/api.d.ts');
const generated = astToString(await openapiTS(spec));

// Assert the published API covers each registered backend route, and vice versa.
// Authentication redirects and health probes intentionally sit outside this API.
const backend = await readFile(path.join(root, 'deployables/portal/server/internal/portal/http.go'), 'utf8');
const actual = new Set([...backend.matchAll(/bind\("(GET|POST|PATCH|PUT|DELETE) ([^" ]+)"/g)].map(m => `${m[1]} ${m[2]}`));
const declared = new Set(Object.entries(spec.paths).flatMap(([p, methods]) =>
  Object.keys(methods).filter(m => ['get', 'post', 'patch', 'put', 'delete'].includes(m)).map(m => `${m.toUpperCase()} ${p}`)));
const mismatches = [...actual].filter(x => !declared.has(x)).map(x => `Missing OpenAPI route: ${x}`)
  .concat([...declared].filter(x => !actual.has(x)).map(x => `Unimplemented OpenAPI route: ${x}`));
if (mismatches.length) throw new Error(mismatches.join('\n'));

if (process.argv.includes('--write')) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, generated);
  console.log('Generated deployables/portal/web/src/generated/api.d.ts');
} else {
  const existing = await readFile(target, 'utf8').catch(() => '');
  if (existing !== generated) throw new Error('API types are stale. Run node scripts/check-contract.mjs --write');
  console.log(`API contract verified: ${actual.size} routes; generated types are current.`);
}
