#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hasArtifact,
  macArtifactArch,
  mergeLatestMacYml,
  parseLatestYml,
  serializeLatestYml,
} from './latest-yml.mjs';

export const parseMergeLatestMacYmlArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
};

const assertVersion = (manifest, version, label) => {
  if (!version) return;
  if (manifest.version !== version) {
    throw new Error(`${label} version ${manifest.version || '(empty)'} does not match release ${version}`);
  }
};

const assertIncomingZips = (files, version) => {
  const archs = new Set(files.map((file) => macArtifactArch(file.url)).filter(Boolean));
  if (archs.size === 0) {
    throw new Error('incoming latest-mac.yml must list a mac-arm64 or mac-x64 file');
  }
  if (!version) return;
  for (const arch of archs) {
    const name = `Pichamber-${version}-mac-${arch}.zip`;
    if (!hasArtifact(files, name)) {
      throw new Error(`incoming latest-mac.yml must list ${name}`);
    }
  }
};

export const mergeLatestMacYmlFiles = async ({
  incoming,
  output,
  existing,
  version,
} = {}) => {
  if (!incoming) throw new Error('--incoming is required');
  if (!output) throw new Error('--output is required');

  const incomingManifest = parseLatestYml(await fs.readFile(incoming, 'utf8'));
  assertVersion(incomingManifest, version, 'incoming latest-mac.yml');
  assertIncomingZips(incomingManifest.files, version);

  let existingManifest = null;
  if (existing) {
    existingManifest = parseLatestYml(await fs.readFile(existing, 'utf8'));
    assertVersion(existingManifest, version, 'existing latest-mac.yml');
  }

  const merged = mergeLatestMacYml(existingManifest, incomingManifest);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, serializeLatestYml(merged));
  return merged;
};

const main = async () => {
  const options = parseMergeLatestMacYmlArgs(process.argv.slice(2));
  const merged = await mergeLatestMacYmlFiles(options);
  const listed = merged.files.map((file) => file.url).join(', ');
  console.log(`wrote ${options.output} with ${merged.files.length} file(s): ${listed}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
