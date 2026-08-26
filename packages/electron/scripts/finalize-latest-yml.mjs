#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  hasArtifact,
  mergeLatestMacYml,
  parseLatestYml,
  serializeLatestYml,
} from './latest-yml.mjs';

const dir = process.env.LATEST_YML_DIR;
const repo = process.env.GH_REPO;
const version = process.env.OPENCHAMBER_VERSION;

if (!dir) throw new Error('LATEST_YML_DIR is required');
if (!repo) throw new Error('GH_REPO is required');
if (!version) throw new Error('OPENCHAMBER_VERSION is required');

const read = async (subdir, filename) => {
  const filePath = path.join(dir, subdir, filename);
  try {
    return parseLatestYml(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const output = {};

const winX64 = await read('latest-yml-x86_64-pc-windows-msvc', 'latest.yml');
const winArm64 = await read('latest-yml-aarch64-pc-windows-msvc', 'latest.yml');
if (!winX64 || !winArm64) {
  throw new Error('Both x64 and arm64 Windows update manifests are required');
}
if (winX64.version !== version || winArm64.version !== version) {
  throw new Error(`Windows update manifest version must be ${version}`);
}
output['latest.yml'] = serializeLatestYml(winX64);
output['latest-arm64.yml'] = serializeLatestYml(winArm64);

// Intel is an optional Release job. A missing x64 artifact stays null;
// latest-mac.yml is still written from the arm64 file.
const macX64 = await read('latest-yml-x86_64-apple-darwin', 'latest-mac.yml');
const macArm64 = await read('latest-yml-aarch64-apple-darwin', 'latest-mac.yml');
if (!macArm64) {
  throw new Error('arm64 latest-mac.yml is required for Mac updates');
}
if (macArm64.version !== version) {
  throw new Error(`latest-mac.yml version ${macArm64.version || '(empty)'} does not match release ${version}`);
}
if (macX64 && macX64.version !== version) {
  throw new Error(`x64 latest-mac.yml version ${macX64.version || '(empty)'} does not match release ${version}`);
}
const mergedMac = macX64 ? mergeLatestMacYml(macArm64, macX64) : macArm64;
if (!hasArtifact(mergedMac.files, `Pichamber-${version}-mac-arm64.zip`)) {
  throw new Error(`latest-mac.yml must list Pichamber-${version}-mac-arm64.zip`);
}
if (macX64 && !hasArtifact(mergedMac.files, `Pichamber-${version}-mac-x64.zip`)) {
  throw new Error(`latest-mac.yml must list Pichamber-${version}-mac-x64.zip`);
}
output['latest-mac.yml'] = serializeLatestYml({
  version: macArm64.version,
  files: mergedMac.files,
  releaseDate: macArm64.releaseDate,
});

const tag = `v${version}`;
const tmp = process.env.RUNNER_TEMP || '/tmp';
for (const [filename, content] of Object.entries(output)) {
  const outputPath = path.join(tmp, filename);
  await fs.writeFile(outputPath, content);
  console.log(`prepared ${outputPath} for upload to ${repo} release ${tag}`);
}

console.log('finalized latest yml files');
