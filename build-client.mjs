#!/usr/bin/env node
// Copy the hand-written client bundle into lib/ after tsdown cleaned it.
import { copyFileSync, existsSync } from 'node:fs';

const src = 'src/client.js';
const dest = 'lib/client.js';

if (!existsSync(src)) {
  console.error('ERROR: ' + src + ' missing — the client bundle source is required');
  process.exit(1);
}

copyFileSync(src, dest);
console.log('Client plugin: ' + src + ' -> ' + dest);
