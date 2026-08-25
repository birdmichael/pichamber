#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const RELEASE_VERSION_PACKAGE_PATHS = [
  'package.json',
  'packages/ui/package.json',
  'packages/web/package.json',
  'packages/electron/package.json',
  'packages/mobile/package.json',
  'packages/vscode/package.json',
];

export const assertReleasePackageVersions = (version, { readFile = fs.readFileSync, root = ROOT } = {}) => {
  if (!version || version === '0.0.0-dev') {
    throw new Error('A concrete release version is required');
  }
  const mismatches = [];
  for (const relativePath of RELEASE_VERSION_PACKAGE_PATHS) {
    const packageJson = JSON.parse(readFile(path.join(root, relativePath), 'utf8'));
    if (packageJson.version !== version) {
      mismatches.push(`${relativePath} is ${packageJson.version}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `package.json versions must match release ${version} before packaging:\n  ${mismatches.join('\n  ')}`,
    );
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertReleasePackageVersions(process.argv[2]);
    console.log(`All release package versions match ${process.argv[2]}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
