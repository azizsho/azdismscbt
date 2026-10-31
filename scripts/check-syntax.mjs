#!/usr/bin/env node
/** Cross-platform syntax check for all project JavaScript. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const folders = ['src', 'scripts', 'test'];
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && full.endsWith('.js')) files.push(full);
  }
}

for (const folder of folders) {
  const full = path.join(root, folder);
  if (fs.existsSync(full)) walk(full);
}

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed++;
    console.error(`FAIL ${path.relative(root, file)}\n${result.stderr}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
}
console.log(`Syntax OK: ${files.length} file(s).`);
