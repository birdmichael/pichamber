import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { mergeLatestMacYml, parseLatestYml, serializeLatestYml } from './latest-yml.mjs';

const script = fileURLToPath(new URL('./merge-latest-mac-yml.mjs', import.meta.url));

const macManifest = (architecture, {
  version = '1.2.3',
  releaseDate = '2026-07-30T00:00:00.000Z',
  includeDmg = true,
} = {}) => {
  const files = [
    `  - url: Pichamber-${version}-mac-${architecture}.zip`,
    `    sha512: mac-${architecture}-zip`,
    '    size: 456',
    '    blockMapSize: 12',
  ];
  if (includeDmg) {
    files.push(
      `  - url: Pichamber-${version}-mac-${architecture}.dmg`,
      `    sha512: mac-${architecture}-dmg`,
      '    size: 789',
    );
  }
  return [
    `version: ${version}`,
    'files:',
    ...files,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');
};

test('writes the incoming feed when latest-mac.yml is not on the Release yet', () => {
  const incoming = parseLatestYml(macManifest('arm64'));
  const merged = mergeLatestMacYml(null, incoming);

  assert.equal(merged.version, '1.2.3');
  assert.equal(merged.releaseDate, '2026-07-30T00:00:00.000Z');
  assert.deepEqual(merged.files.map((file) => file.url), [
    'Pichamber-1.2.3-mac-arm64.zip',
    'Pichamber-1.2.3-mac-arm64.dmg',
  ]);
  assert.equal(merged.files[0].blockMapSize, 12);
  assert.match(serializeLatestYml(merged), /Pichamber-1\.2\.3-mac-arm64\.zip/);
  assert.doesNotMatch(serializeLatestYml(merged), /mac-x64/);
});

test('merges a later x64 feed into an existing arm64-only latest-mac.yml', () => {
  const existing = parseLatestYml(macManifest('arm64', { releaseDate: '2026-08-26T10:00:00.000Z' }));
  const incoming = parseLatestYml(macManifest('x64', { releaseDate: '2026-08-26T16:00:00.000Z' }));
  const merged = mergeLatestMacYml(existing, incoming);

  assert.equal(merged.version, '1.2.3');
  assert.equal(merged.releaseDate, '2026-08-26T16:00:00.000Z');
  assert.deepEqual(merged.files.map((file) => file.url), [
    'Pichamber-1.2.3-mac-arm64.zip',
    'Pichamber-1.2.3-mac-arm64.dmg',
    'Pichamber-1.2.3-mac-x64.zip',
    'Pichamber-1.2.3-mac-x64.dmg',
  ]);
  assert.equal(merged.files[0].sha512, 'mac-arm64-zip');
  assert.equal(merged.files[2].sha512, 'mac-x64-zip');
});

test('merges a later arm64 feed into an existing x64-only latest-mac.yml', () => {
  const existing = parseLatestYml(macManifest('x64'));
  const incoming = parseLatestYml(macManifest('arm64'));
  const merged = mergeLatestMacYml(existing, incoming);

  assert.deepEqual(merged.files.map((file) => file.url), [
    'Pichamber-1.2.3-mac-x64.zip',
    'Pichamber-1.2.3-mac-x64.dmg',
    'Pichamber-1.2.3-mac-arm64.zip',
    'Pichamber-1.2.3-mac-arm64.dmg',
  ]);
});

test('replaces the same arch instead of duplicating zip or dmg entries', () => {
  const existing = parseLatestYml(macManifest('arm64'));
  existing.files[0].sha512 = 'stale-arm64-zip';
  const incoming = parseLatestYml(macManifest('arm64'));
  incoming.files[0].sha512 = 'fresh-arm64-zip';
  const merged = mergeLatestMacYml(existing, incoming);

  assert.deepEqual(merged.files.map((file) => file.url), [
    'Pichamber-1.2.3-mac-arm64.zip',
    'Pichamber-1.2.3-mac-arm64.dmg',
  ]);
  assert.equal(merged.files[0].sha512, 'fresh-arm64-zip');
});

test('CLI merges an existing arm64 feed with a later x64 file', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pichamber-merge-mac-yml-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const existing = path.join(root, 'existing.yml');
  const incoming = path.join(root, 'incoming.yml');
  const output = path.join(root, 'out', 'latest-mac.yml');
  fs.writeFileSync(existing, macManifest('arm64'));
  fs.writeFileSync(incoming, macManifest('x64', { includeDmg: false }));

  execFileSync(process.execPath, [
    script,
    '--existing', existing,
    '--incoming', incoming,
    '--output', output,
    '--version', '1.2.3',
  ]);

  const written = fs.readFileSync(output, 'utf8');
  assert.match(written, /Pichamber-1\.2\.3-mac-arm64\.zip/);
  assert.match(written, /Pichamber-1\.2\.3-mac-arm64\.dmg/);
  assert.match(written, /Pichamber-1\.2\.3-mac-x64\.zip/);
  assert.doesNotMatch(written, /Pichamber-1\.2\.3-mac-x64\.dmg/);
});

test('CLI copies the incoming feed when no existing file is passed', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pichamber-merge-mac-yml-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const incoming = path.join(root, 'incoming.yml');
  const output = path.join(root, 'latest-mac.yml');
  fs.writeFileSync(incoming, macManifest('arm64'));

  execFileSync(process.execPath, [
    script,
    '--incoming', incoming,
    '--output', output,
    '--version', '1.2.3',
  ]);

  const written = fs.readFileSync(output, 'utf8');
  assert.match(written, /Pichamber-1\.2\.3-mac-arm64\.zip/);
  assert.doesNotMatch(written, /mac-x64/);
});

test('CLI fails closed on a version mismatch', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pichamber-merge-mac-yml-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const incoming = path.join(root, 'incoming.yml');
  const output = path.join(root, 'latest-mac.yml');
  fs.writeFileSync(incoming, macManifest('arm64', { version: '9.9.9' }));

  const result = spawnSync(process.execPath, [
    script,
    '--incoming', incoming,
    '--output', output,
    '--version', '1.2.3',
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match release 1\.2\.3/);
  assert.equal(fs.existsSync(output), false);
});
