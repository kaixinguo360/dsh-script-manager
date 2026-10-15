#!/usr/bin/env node
/**
 * Publish the hand-written client bundle into lib/ after tsdown cleaned it, and
 * enforce the invariants the browser side depends on. Both are cheap to check
 * here and expensive to discover in a browser: each one makes the plugin fail to
 * appear at all, with no server-side error pointing at it.
 *
 * 1. The registration id must be the package's bare name. The host composes its
 *    boot graph from Loader entries keyed by package name and the browser loader
 *    materializes a row by looking up a factory registered under that exact id,
 *    so any other spelling (a stale `<name>/client` form, say) is never
 *    materialized and the profile fails to boot.
 * 2. Every `P.<Name>` atom read from @deepseek-ai/dsh-client-ui-primitives must
 *    exist in the version this bundle is built against. A renamed or dropped
 *    atom becomes an `undefined` React element type, which throws at render time
 *    and takes down whatever slot entry mounted the component.
 */
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';

const src = 'src/client.js';
const dest = 'lib/client.js';
/** The primitives namespace the bundle reads atoms from. */
const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives';

if (!existsSync(src)) {
  console.error('ERROR: ' + src + ' missing — the client bundle source is required');
  process.exit(1);
}

const source = readFileSync(src, 'utf8');
const packageName = JSON.parse(readFileSync('package.json', 'utf8')).name;
const failures = [];

// 1. Registration id.
const REGISTRATION = /__ModuleLoader__\.load\(\s*\{[\s\S]*?\bid:\s*['"]([^'"]+)['"]/;
const registered = REGISTRATION.exec(source)?.[1];
if (registered === undefined) {
  console.error('ERROR: ' + src + ' has no window.__ModuleLoader__.load({ id, factory }) registration');
  process.exit(1);
}
if (registered !== packageName) {
  failures.push(
    'registers client id ' + JSON.stringify(registered) + ' but the package name is ' +
    JSON.stringify(packageName) + ' — the loader keys boot-graph rows by package name, ' +
    'so the plugin would never load',
  );
}

// 2. Primitives atoms.
const primitivesEntry = createRequire(import.meta.url).resolve(PRIMITIVES);
const available = new Set(
  [...readFileSync(primitivesEntry, 'utf8').matchAll(/export\s*\{([^}]*)\}/g)]
    .flatMap((match) => match[1].split(','))
    .map((name) => name.trim())
    .filter(Boolean),
);
if (available.size === 0) {
  console.error('ERROR: could not read any named export from ' + primitivesEntry);
  process.exit(1);
}
const used = [...new Set([...source.matchAll(/\bP\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]))].sort();
const missing = used.filter((name) => !available.has(name));
if (missing.length > 0) {
  failures.push(
    'reads ' + missing.length + ' atom(s) absent from ' + PRIMITIVES + ': ' + missing.join(', ') +
    ' — each would render as an undefined element type and crash its slot entry',
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error('ERROR: ' + src + ' ' + failure);
  process.exit(1);
}

copyFileSync(src, dest);
console.log(
  'Client plugin: ' + src + ' -> ' + dest +
  ' (id ' + registered + ', ' + used.length + ' primitives atoms verified)',
);
