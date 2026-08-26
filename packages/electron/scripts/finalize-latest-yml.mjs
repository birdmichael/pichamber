#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const dir = process.env.LATEST_YML_DIR;
const repo = process.env.GH_REPO;
const version = process.env.OPENCHAMBER_VERSION;

if (!dir) throw new Error('LATEST_YML_DIR is required');
if (!repo) throw new Error('GH_REPO is required');
if (!version) throw new Error('OPENCHAMBER_VERSION is required');

const parse = (content) => {
  const lines = content.split('\n');
  let releaseDate = '';
  let parsedVersion = '';
  const files = [];
  let current;

  const flush = () => {
    if (current?.url && current?.sha512 && current?.size) {
      files.push(current);
    }
    current = undefined;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const indented = line.startsWith('    ') || line.startsWith('  -');
    if (line.startsWith('version:')) {
      parsedVersion = line.slice('version:'.length).trim();
    } else if (line.startsWith('releaseDate:')) {
      releaseDate = line.slice('releaseDate:'.length).trim().replace(/^'|'$/g, '');
    } else if (trimmed.startsWith('- url:')) {
      flush();
      current = { url: trimmed.slice('- url:'.length).trim() };
    } else if (indented && current && trimmed.startsWith('sha512:')) {
      current.sha512 = trimmed.slice('sha512:'.length).trim();
    } else if (indented && current && trimmed.startsWith('size:')) {
      current.size = Number(trimmed.slice('size:'.length).trim());
    } else if (indented && current && trimmed.startsWith('blockMapSize:')) {
      current.blockMapSize = Number(trimmed.slice('blockMapSize:'.length).trim());
    } else if (!indented && current) {
      flush();
    }
  }

  flush();
  return { version: parsedVersion, releaseDate, files };
};

const serialize = (data) => {
  const lines = [`version: ${data.version}`, 'files:'];
  for (const file of data.files) {
    lines.push(`  - url: ${file.url}`);
    lines.push(`    sha512: ${file.sha512}`);
    lines.push(`    size: ${file.size}`);
    if (file.blockMapSize) {
      lines.push(`    blockMapSize: ${file.blockMapSize}`);
    }
  }
  lines.push(`releaseDate: '${data.releaseDate}'`);
  return `${lines.join('\n')}\n`;
};

const read = async (subdir, filename) => {
  const filePath = path.join(dir, subdir, filename);
  try {
    return parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const output = {};

const hasArtifact = (files, name) => files.some((file) => (
  decodeURIComponent(String(file.url || '')).includes(name)
));

const winX64 = await read('latest-yml-x86_64-pc-windows-msvc', 'latest.yml');
const winArm64 = await read('latest-yml-aarch64-pc-windows-msvc', 'latest.yml');
if (!winX64 || !winArm64) {
  throw new Error('Both x64 and arm64 Windows update manifests are required');
}
if (winX64.version !== version || winArm64.version !== version) {
  throw new Error(`Windows update manifest version must be ${version}`);
}
output['latest.yml'] = serialize(winX64);
output['latest-arm64.yml'] = serialize(winArm64);

// GitHub Release packages Apple Silicon only. A missing Intel artifact stays
// null; latest-mac.yml is still written from the arm64 file.
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
const macFiles = [...macArm64.files, ...(macX64?.files || [])];
if (!hasArtifact(macFiles, `Pichamber-${version}-mac-arm64.zip`)) {
  throw new Error(`latest-mac.yml must list Pichamber-${version}-mac-arm64.zip`);
}
if (macX64 && !hasArtifact(macFiles, `Pichamber-${version}-mac-x64.zip`)) {
  throw new Error(`latest-mac.yml must list Pichamber-${version}-mac-x64.zip`);
}
output['latest-mac.yml'] = serialize({
  version: macArm64.version,
  files: macFiles,
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
