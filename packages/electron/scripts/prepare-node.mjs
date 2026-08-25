#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveInstalledPiSdkInfo } from '../../web/server/lib/pi/node-runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const webRoot = path.resolve(electronRoot, '../web');
const outputDir = path.join(electronRoot, 'resources', 'node', 'bin');
const cacheRoot = path.join(electronRoot, '.cache', 'node');
const outputName = process.platform === 'win32' ? 'node.exe' : 'node';
const outputPath = path.join(outputDir, outputName);
const PI_SDK_PACKAGE = '@earendil-works/pi-coding-agent';

const basenameOf = (filePath) => path.basename(filePath || '').toLowerCase();

export const isNodeBinary = (filePath) => {
  const name = basenameOf(filePath);
  return name === 'node' || name === 'node.exe';
};

export const pickOfficialNodeReleases = (index, { platform = process.platform, arch = process.arch } = {}) => {
  const plat = platform === 'win32' ? 'win' : platform === 'darwin' ? 'darwin' : 'linux';
  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  const fileKey = `${plat}-${arch}`;
  const out = [];
  const seen = new Set();
  const add = (entry) => {
    if (!entry?.version || seen.has(entry.version)) return;
    if (!Array.isArray(entry.files) || !entry.files.includes(fileKey)) return;
    seen.add(entry.version);
    const name = `node-${entry.version}-${plat}-${arch}.${ext}`;
    out.push({
      version: entry.version,
      lts: Boolean(entry.lts),
      url: `https://nodejs.org/dist/${entry.version}/${name}`,
      name,
    });
  };
  if (Array.isArray(index) && index[0]) add(index[0]);
  for (const entry of Array.isArray(index) ? index : []) {
    if (entry?.lts) {
      add(entry);
      break;
    }
  }
  for (const entry of Array.isArray(index) ? index.slice(0, 15) : []) add(entry);
  return out;
};

export const probeNodeLoadsPiSdk = ({
  command,
  cwd = webRoot,
  env = process.env,
  spawnImpl = spawnSync,
} = {}) => {
  if (!command) return { ok: false, error: 'No Node binary' };
  const result = spawnImpl(command, [
    '--input-type=module',
    '-e',
    `import(${JSON.stringify(PI_SDK_PACKAGE)}).then(() => process.exit(0)).catch((error) => { console.error(error?.message || error); process.exit(2); })`,
  ], {
    cwd,
    env: { ...env },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status === 0) return { ok: true };
  const error = String(result.stderr || result.stdout || `exit ${result.status}`).trim();
  return { ok: false, error };
};

const resolveSdkPackageRoot = async () => {
  const info = await resolveInstalledPiSdkInfo();
  if (info.error || !info.packagePath) {
    throw new Error(info.error || `Could not resolve ${PI_SDK_PACKAGE}`);
  }
  return path.dirname(info.packagePath);
};

const localNodeCandidates = () => {
  const names = [];
  const override = typeof process.env.PICHAMBER_NODE_BINARY === 'string'
    ? process.env.PICHAMBER_NODE_BINARY.trim()
    : '';
  if (override) names.push(override);
  if (isNodeBinary(process.execPath)) names.push(process.execPath);
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['node'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  for (const line of String(which.stdout || '').split(/\r?\n/)) {
    if (line.trim()) names.push(line.trim());
  }
  if (fs.existsSync(outputPath)) names.push(outputPath);
  return [...new Set(names.map((item) => path.resolve(item)).filter((item) => (
    fs.existsSync(item) && isNodeBinary(item)
  )))];
};

const stageBinary = (source) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(source, outputPath);
  if (process.platform !== 'win32') {
    fs.chmodSync(outputPath, 0o755);
  }
  return outputPath;
};

const downloadOfficialNode = async (release) => {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const archivePath = path.join(cacheRoot, release.name);
  const response = await fetch(release.url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${release.url}`);
  }
  fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
  const extractDir = path.join(cacheRoot, release.version.replace(/^v/, ''));
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  if (release.name.endsWith('.zip')) {
    const unzip = spawnSync('unzip', ['-q', archivePath, '-d', extractDir], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (unzip.status !== 0) {
      throw new Error(`unzip failed: ${unzip.stderr || unzip.stdout}`);
    }
  } else {
    const tar = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir, '--strip-components=1'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (tar.status !== 0) {
      throw new Error(`tar failed: ${tar.stderr || tar.stdout}`);
    }
  }
  const staged = path.join(extractDir, 'bin', outputName);
  const windowsStaged = path.join(extractDir, outputName);
  if (fs.existsSync(staged)) return staged;
  if (fs.existsSync(windowsStaged)) return windowsStaged;
  throw new Error(`Extracted Node binary missing for ${release.version}`);
};

export const preparePiNodeBinary = async ({
  probe = probeNodeLoadsPiSdk,
  fetchIndex = async () => {
    const response = await fetch('https://nodejs.org/dist/index.json');
    if (!response.ok) throw new Error(`nodejs.org index failed: ${response.status}`);
    return response.json();
  },
  downloadRelease = downloadOfficialNode,
  platform = process.platform,
  arch = process.arch,
} = {}) => {
  await resolveSdkPackageRoot();
  for (const candidate of localNodeCandidates()) {
    const probed = probe({ command: candidate, cwd: webRoot });
    if (probed.ok) {
      const staged = stageBinary(candidate);
      return { path: staged, source: candidate, downloaded: false };
    }
    console.warn(`[electron] Node ${candidate} cannot load ${PI_SDK_PACKAGE}: ${probed.error}`);
  }

  const index = await fetchIndex();
  const releases = pickOfficialNodeReleases(index, { platform, arch });
  if (releases.length === 0) {
    throw new Error(`No official Node builds for ${platform}/${arch}`);
  }
  for (const release of releases) {
    try {
      const downloaded = await downloadRelease(release);
      const probed = probe({ command: downloaded, cwd: webRoot });
      if (probed.ok) {
        const staged = stageBinary(downloaded);
        return { path: staged, source: release.url, downloaded: true, version: release.version };
      }
      console.warn(`[electron] Official ${release.version} cannot load ${PI_SDK_PACKAGE}: ${probed.error}`);
    } catch (error) {
      console.warn(`[electron] failed to stage official ${release.version}: ${error?.message || error}`);
    }
  }
  throw new Error(
    `Packaged Desktop needs a Node.js binary that can load ${PI_SDK_PACKAGE}. `
    + 'Install a supported Node or set PICHAMBER_NODE_BINARY, then rerun prepare:node.',
  );
};

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const result = await preparePiNodeBinary();
  console.log(`[electron] staged Node for the Pi kernel: ${result.path}`);
  console.log(`[electron] source: ${result.source}`);
}
