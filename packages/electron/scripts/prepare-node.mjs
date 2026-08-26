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

const NON_RELOCATABLE_LIBRARY = /libnode(?:\.\d+)?\.(?:dylib|so)|\b(?:\/opt\/homebrew\/|\/usr\/local\/(?:opt|Cellar)\/|\/home\/linuxbrew\/|\/opt\/local\/)/i;

export const listLinkedLibraries = ({
  command,
  platform = process.platform,
  spawnImpl = spawnSync,
} = {}) => {
  if (!command) return { libraries: [], error: 'No Node binary' };
  if (platform === 'win32') return { libraries: [] };
  const result = platform === 'darwin'
    ? spawnImpl('otool', ['-L', command], { encoding: 'utf8', windowsHide: true })
    : spawnImpl('ldd', [command], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    return {
      libraries: [],
      error: String(result.stderr || result.stdout || `exit ${result.status}`).trim(),
    };
  }
  return {
    libraries: String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  };
};

const PUBLIC_NODE_VERSION = /^v\d+\.\d+\.\d+$/;

export const readNodeReleaseVersion = ({
  command,
  spawnImpl = spawnSync,
} = {}) => {
  if (!command) return '';
  const result = spawnImpl(command, ['-p', 'process.version'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
};

export const isPublicNodeReleaseVersion = (version) => PUBLIC_NODE_VERSION.test(String(version || '').trim());

export const isRelocatableNodeBinary = (input) => {
  const inspected = typeof input === 'string'
    ? listLinkedLibraries({ command: input })
    : input;
  if (inspected?.error) return { ok: false, error: inspected.error };
  const blocked = (inspected?.libraries || []).find((line) => NON_RELOCATABLE_LIBRARY.test(line));
  if (blocked) {
    return { ok: false, error: `not relocatable (${blocked})` };
  }
  return { ok: true };
};

export const officialNodeFileKey = ({ platform = process.platform, arch = process.arch } = {}) => {
  if (platform === 'darwin') return `osx-${arch}-tar`;
  if (platform === 'win32') return `win-${arch}-zip`;
  return `linux-${arch}`;
};

export const pickOfficialNodeReleases = (index, { platform = process.platform, arch = process.arch } = {}) => {
  const plat = platform === 'win32' ? 'win' : platform === 'darwin' ? 'darwin' : 'linux';
  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  const fileKey = officialNodeFileKey({ platform, arch });
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
  if (Array.isArray(index)) {
    const lts = index.find((entry) => entry?.lts);
    if (lts) add(lts);
    if (index[0]) add(index[0]);
    for (const entry of index.slice(0, 15)) add(entry);
  }
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

const downloadToFile = async (url, destination) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}): ${url}`);
    }
    fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
    return;
  } catch (error) {
    const curl = spawnSync('curl', ['-fsSL', '--retry', '3', '--retry-delay', '1', '-o', destination, url], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (curl.status === 0 && fs.existsSync(destination)) return;
    throw new Error(`${error?.message || error}; curl: ${curl.stderr || curl.stdout || `exit ${curl.status}`}`);
  }
};

const downloadOfficialNode = async (release) => {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const archivePath = path.join(cacheRoot, release.name);
  await downloadToFile(release.url, archivePath);
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
  readVersion = readNodeReleaseVersion,
  fetchIndex = async () => {
    const indexPath = path.join(cacheRoot, 'index.json');
    fs.mkdirSync(cacheRoot, { recursive: true });
    try {
      const response = await fetch('https://nodejs.org/dist/index.json');
      if (!response.ok) throw new Error(`nodejs.org index failed: ${response.status}`);
      return response.json();
    } catch (error) {
      await downloadToFile('https://nodejs.org/dist/index.json', indexPath);
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }
  },
  downloadRelease = downloadOfficialNode,
  platform = process.platform,
  arch = process.arch,
} = {}) => {
  const acceptStaged = (staged, source, extra = {}) => {
    const relocatable = isRelocatableNodeBinary(staged);
    if (!relocatable.ok) {
      console.warn(`[electron] staged Node from ${source} ${relocatable.error}`);
      return null;
    }
    const probed = probe({ command: staged, cwd: webRoot });
    if (!probed.ok) {
      console.warn(`[electron] staged Node from ${source} cannot load ${PI_SDK_PACKAGE}: ${probed.error}`);
      return null;
    }
    return { path: staged, source, ...extra };
  };

  await resolveSdkPackageRoot();
  for (const candidate of localNodeCandidates()) {
    const version = readVersion({ command: candidate });
    if (!isPublicNodeReleaseVersion(version)) {
      console.warn(`[electron] Node ${candidate} is not a public nodejs.org release (${version || 'unknown'})`);
      continue;
    }
    const relocatable = isRelocatableNodeBinary(candidate);
    if (!relocatable.ok) {
      console.warn(`[electron] Node ${candidate} ${relocatable.error}`);
      continue;
    }
    const probed = probe({ command: candidate, cwd: webRoot });
    if (!probed.ok) {
      console.warn(`[electron] Node ${candidate} cannot load ${PI_SDK_PACKAGE}: ${probed.error}`);
      continue;
    }
    const accepted = acceptStaged(stageBinary(candidate), candidate, { downloaded: false });
    if (accepted) return accepted;
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
      if (!probed.ok) {
        console.warn(`[electron] Official ${release.version} cannot load ${PI_SDK_PACKAGE}: ${probed.error}`);
        continue;
      }
      const accepted = acceptStaged(stageBinary(downloaded), release.url, {
        downloaded: true,
        version: release.version,
      });
      if (accepted) return accepted;
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
