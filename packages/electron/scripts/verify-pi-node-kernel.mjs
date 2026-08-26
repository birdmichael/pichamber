import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { probeNodeLoadsPiSdk } from './prepare-node.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const webRoot = path.resolve(electronRoot, '../web');

const NODE_CHILD = path.join('lib', 'pi', 'node-kernel-child.js');
const UNPACKED_CHILD_SUFFIX = path.join(
  'app.asar.unpacked',
  'node_modules',
  '@pichamber',
  'web',
  'server',
  NODE_CHILD,
);

export const packagedNodeBinaryRelative = (platform = process.platform) => (
  platform === 'win32'
    ? path.join('node', 'bin', 'node.exe')
    : path.join('node', 'bin', 'node')
);

const isFile = (filePath) => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const collectDirs = (root, predicate, matches = []) => {
  if (!fs.existsSync(root)) return matches;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (!entry.isDirectory()) continue;
    if (predicate(entry.name, fullPath)) matches.push(fullPath);
    collectDirs(fullPath, predicate, matches);
  }
  return matches;
};

export const findPackagedResourceRoots = (distDir = path.join(electronRoot, 'dist')) => {
  const roots = new Set();
  for (const appDir of collectDirs(distDir, (name) => name.endsWith('.app'))) {
    roots.add(path.join(appDir, 'Contents', 'Resources'));
  }
  for (const resourcesDir of collectDirs(distDir, (name) => name === 'resources')) {
    roots.add(resourcesDir);
  }
  return [...roots].filter((dir) => fs.existsSync(dir));
};

export const assertPiNodeKernelLayout = ({
  resourcesPath,
  platform = process.platform,
} = {}) => {
  if (!resourcesPath) {
    throw new Error('resourcesPath is required');
  }
  const nodeBinary = path.join(resourcesPath, packagedNodeBinaryRelative(platform));
  const unpackedChild = path.join(resourcesPath, UNPACKED_CHILD_SUFFIX);

  if (!isFile(nodeBinary)) {
    throw new Error(`Packaged Desktop is missing the bundled Node binary: ${nodeBinary}`);
  }
  if (!isFile(unpackedChild)) {
    throw new Error(`Packaged Desktop is missing the unpacked Pi node kernel child: ${unpackedChild}`);
  }
  return { nodeBinary, unpackedChild };
};

export const assertPiNodeKernelLoadsSdk = ({
  nodeBinary,
  cwd = webRoot,
  probe = probeNodeLoadsPiSdk,
} = {}) => {
  const probed = probe({ command: nodeBinary, cwd });
  if (!probed.ok) {
    throw new Error(
      `Bundled Node cannot import @earendil-works/pi-coding-agent: ${probed.error || 'probe failed'}`,
    );
  }
  return probed;
};

export const verifyPackagedPiNodeKernel = ({
  distDir = path.join(electronRoot, 'dist'),
  resourcesPaths,
  platform = process.platform,
  probeSdk = true,
  probe = probeNodeLoadsPiSdk,
} = {}) => {
  const roots = Array.isArray(resourcesPaths) && resourcesPaths.length > 0
    ? resourcesPaths
    : findPackagedResourceRoots(distDir);
  if (roots.length === 0) {
    throw new Error(`No packaged Desktop Resources directory found under ${distDir}`);
  }
  const verified = [];
  for (const resourcesPath of roots) {
    const layout = assertPiNodeKernelLayout({ resourcesPath, platform });
    if (probeSdk) {
      assertPiNodeKernelLoadsSdk({ nodeBinary: layout.nodeBinary, probe });
    }
    verified.push({ resourcesPath, ...layout });
    console.log(`[electron] verified Pi node kernel: ${layout.unpackedChild}`);
    console.log(`[electron] verified bundled Node: ${layout.nodeBinary}`);
  }
  return verified;
};

const usage = () => {
  console.error('Usage: node scripts/verify-pi-node-kernel.mjs --staged|--packaged');
  process.exit(2);
};

const main = () => {
  const mode = process.argv[2];
  if (mode !== '--staged' && mode !== '--packaged') usage();
  if (mode === '--staged') {
    const resourcesPath = path.join(electronRoot, 'resources');
    const nodeBinary = path.join(resourcesPath, packagedNodeBinaryRelative());
    if (!isFile(nodeBinary)) {
      throw new Error(`Staged Node binary missing. Run prepare:node first: ${nodeBinary}`);
    }
    assertPiNodeKernelLoadsSdk({ nodeBinary });
    console.log(`[electron] verified staged Node: ${nodeBinary}`);
    return;
  }
  verifyPackagedPiNodeKernel();
};

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
