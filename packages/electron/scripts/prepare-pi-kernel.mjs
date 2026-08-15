#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(electronRoot, '../..');
const webRoot = path.join(workspaceRoot, 'packages/web');

const candidates = [
  path.join(webRoot, 'node_modules/@earendil-works/pi-coding-agent/package.json'),
  path.join(workspaceRoot, 'node_modules/@earendil-works/pi-coding-agent/package.json'),
];

const packageJsonPath = candidates.find((candidate) => fs.existsSync(candidate));
if (!packageJsonPath) {
  throw new Error(
    'Mac desktop boots the in-process Pi kernel, but @earendil-works/pi-coding-agent is not installed. '
      + 'Run `bun install` from the repo root.',
  );
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
if (pkg.name !== '@earendil-works/pi-coding-agent') {
  throw new Error(`Unexpected Pi package at ${packageJsonPath}: ${pkg.name || 'unknown'}`);
}

const entry = path.join(path.dirname(packageJsonPath), 'dist', 'index.js');
if (!fs.existsSync(entry)) {
  throw new Error(`Pi SDK is installed but missing ${entry}. Re-run bun install.`);
}

console.log(`[electron] Pi kernel ready: ${pkg.name}@${pkg.version}`);
console.log('[electron] Desktop does not start a managed OpenCode process. Set OPENCHAMBER_KERNEL=opencode to restore that path.');
