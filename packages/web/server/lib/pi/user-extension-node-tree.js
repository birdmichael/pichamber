import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { listUserNpmTrees } from './user-extension-native.js';
import {
  discoverNativePackageCandidates,
  isolatedPackageDir,
} from './user-extension-electron-tree.js';

const NODE_PREFIX = 'npm-node';
const STAMP_NAME = '.pichamber-node.json';
const STAMP_KIND = 'official-headers';
const PUBLIC_NODE_VERSION = /^v\d+\.\d+\.\d+$/;
const NODE_DIST_INDEX = 'https://nodejs.org/dist/index.json';
const NODE_DIST_ROOT = 'https://nodejs.org/download/release';

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const asVersions = (versions) => (
  versions && typeof versions === 'object' ? versions : {}
);

const isDirectory = (value) => {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (value) => {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
};

const realPath = (value) => {
  if (typeof value !== 'string' || !value) return '';
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
};

const readJsonObject = (filePath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const runtimeFromContext = (context) => ({
  versions: context?.versions || process.versions,
  platform: context?.platform || process.platform,
  arch: context?.arch || process.arch,
  nodeBinary: asText(context?.nodeBinary) || process.execPath,
});

export const nodeRuntimeKey = ({
  versions = process.versions,
  platform = process.platform,
  arch = process.arch,
} = {}) => {
  const modules = asVersions(versions).modules;
  return `node-${modules == null ? '' : String(modules)}-${platform}-${arch}`;
};

export const officialNodeVersionFromProcess = (versions = process.versions) => {
  const raw = asText(asVersions(versions).node) || asText(versions?.node);
  const normalized = raw.startsWith('v') ? raw : (raw ? `v${raw}` : '');
  return PUBLIC_NODE_VERSION.test(normalized) ? normalized : '';
};

export const pickOfficialNodeVersionForModules = (index, modules) => {
  const wanted = modules == null ? '' : String(modules);
  if (!wanted) return '';
  const entries = Array.isArray(index) ? index : [];
  const match = entries.find((entry) => (
    String(entry?.modules) === wanted && PUBLIC_NODE_VERSION.test(asText(entry?.version))
  ));
  return asText(match?.version);
};

const defaultFetchIndex = async () => {
  const response = await fetch(NODE_DIST_INDEX);
  if (!response.ok) throw new Error(`nodejs.org index failed: ${response.status}`);
  return response.json();
};

const defaultDownloadToFile = async (url, dest) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
};

export const resolveOfficialNodeCompileTarget = async ({
  versions = process.versions,
  fetchIndex = defaultFetchIndex,
} = {}) => {
  const fromProcess = officialNodeVersionFromProcess(versions);
  if (fromProcess) {
    return { version: fromProcess, fromProcess: true };
  }
  const modules = asVersions(versions).modules;
  const version = pickOfficialNodeVersionForModules(await fetchIndex(), modules);
  if (!version) {
    throw new Error(`no official Node release for NODE_MODULE_VERSION ${modules == null ? '' : String(modules)}`);
  }
  return { version, fromProcess: false };
};

export const ensureOfficialNodeHeaders = async ({
  version,
  cacheRoot,
  downloadToFile = defaultDownloadToFile,
  spawnSyncImpl = spawnSync,
} = {}) => {
  const release = asText(version);
  const root = asText(cacheRoot);
  if (!release || !root) return { ok: false, error: 'headers cache is missing' };
  const dest = path.join(root, release);
  const nodeH = path.join(dest, 'include', 'node', 'node.h');
  if (isFile(nodeH)) return { ok: true, nodedir: dest, version: release };
  const url = `${NODE_DIST_ROOT}/${release}/node-${release}-headers.tar.gz`;
  const archive = path.join(root, `${release}-headers.tar.gz`);
  await downloadToFile(url, archive);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const extracted = spawnSyncImpl('tar', ['-xzf', archive, '-C', dest, '--strip-components=1'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  try {
    fs.rmSync(archive, { force: true });
  } catch {
  }
  if (extracted.status !== 0 || !isFile(nodeH)) {
    const error = asText(extracted.stderr) || asText(extracted.stdout) || `tar exited ${extracted.status}`;
    return { ok: false, error };
  }
  return { ok: true, nodedir: dest, version: release };
};

const headersCacheRootFor = (context) => {
  if (asText(context?.headersCacheRoot)) return asText(context.headersCacheRoot);
  if (asText(context?.agentDir)) return path.join(asText(context.agentDir), NODE_PREFIX, '.headers');
  return path.join(os.tmpdir(), 'pichamber-node-headers');
};

export const nodeTreeRootForNpm = (npmRoot, runtime = {}) => (
  path.join(path.dirname(npmRoot), NODE_PREFIX, nodeRuntimeKey(runtime))
);

const listUserNodeTreeRoots = ({
  agentDir,
  projectDir,
  versions = process.versions,
  platform = process.platform,
  arch = process.arch,
} = {}) => (
  listUserNpmTrees({ agentDir, projectDir })
    .filter((tree) => tree.kind === 'cli')
    .map((tree) => ({
      ...tree,
      nodeRoot: nodeTreeRootForNpm(tree.root, { versions, platform, arch }),
    }))
);

const collectCandidates = (context) => {
  const runtime = runtimeFromContext(context);
  const found = [];
  const seen = new Set();
  for (const tree of listUserNodeTreeRoots({
    agentDir: context?.agentDir,
    projectDir: context?.projectDir,
    ...runtime,
  })) {
    for (const candidate of discoverNativePackageCandidates(tree.root)) {
      const key = `${tree.root}\0${candidate.name}@${candidate.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        ...candidate,
        treeRoot: tree.root,
        nodeRoot: tree.nodeRoot,
        scope: tree.scope,
      });
    }
  }
  return found;
};

const readNodeStamp = (isolatedDir) => {
  const stamp = readJsonObject(path.join(isolatedDir, STAMP_NAME));
  return stamp && typeof stamp === 'object' ? stamp : null;
};

export const isValidNodeCache = (isolatedDir, candidate, runtime) => {
  if (!isDirectory(isolatedDir) || !isFile(path.join(isolatedDir, 'package.json'))) return false;
  const stamp = readNodeStamp(isolatedDir);
  if (!stamp || stamp.ok !== true) return false;
  return stamp.name === candidate.name
    && stamp.version === candidate.version
    && stamp.runtime === nodeRuntimeKey(runtime);
};

const shouldSkipPreviousFailure = (isolatedDir) => {
  const stamp = readNodeStamp(isolatedDir);
  return stamp?.ok === false && stamp.kind === STAMP_KIND;
};

const writeStamp = (isolatedDir, candidate, runtime, ok, error) => {
  fs.writeFileSync(path.join(isolatedDir, STAMP_NAME), `${JSON.stringify({
    ok: Boolean(ok),
    kind: STAMP_KIND,
    name: candidate.name,
    version: candidate.version,
    runtime: nodeRuntimeKey(runtime),
    ...(error ? { error: String(error) } : {}),
  }, null, 2)}\n`);
};

const copyWholePackage = (sourceDir, destDir) => {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(sourceDir, destDir, {
    recursive: true,
    dereference: false,
    filter: (src) => path.basename(src) !== STAMP_NAME,
  });
};

export const rebuildIsolatedNativePackageForNode = ({
  packageDir,
  nodeBinary = process.execPath,
  nodeHeadersDir,
  nodeTarget,
  extraBinDirs = [],
  spawnSyncImpl = spawnSync,
} = {}) => {
  const dir = asText(packageDir);
  if (!dir) return { ok: false, error: 'isolated package directory is missing' };
  const nodeDir = path.dirname(asText(nodeBinary) || process.execPath);
  const pathParts = [
    path.join(dir, 'node_modules', '.bin'),
    ...extraBinDirs.filter(Boolean),
    nodeDir,
    process.env.PATH || '',
  ];
  const env = {
    ...process.env,
    PATH: pathParts.join(path.delimiter),
    npm_config_runtime: 'node',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const headersDir = asText(nodeHeadersDir);
  const target = asText(nodeTarget).replace(/^v/, '');
  if (headersDir) env.npm_config_nodedir = headersDir;
  if (target) {
    env.npm_config_target = target;
    env.npm_config_disturl = NODE_DIST_ROOT;
  } else {
    delete env.npm_config_target;
    delete env.npm_config_disturl;
  }
  const result = spawnSyncImpl('npm', ['rebuild'], {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: 180_000,
  });
  if (result.status === 0) return { ok: true, method: 'npm-rebuild' };
  const error = asText(result.stderr) || asText(result.stdout) || `npm rebuild exited ${result.status}`;
  return { ok: false, error };
};

export const syncUserExtensionNodeTree = async (context = {}) => {
  const runtime = runtimeFromContext(context);
  let nodeTarget = '';
  let nodeHeadersDir = '';
  if (typeof context.rebuildPackage !== 'function') {
    try {
      const target = await resolveOfficialNodeCompileTarget({
        versions: runtime.versions,
        fetchIndex: context.fetchIndex,
      });
      nodeTarget = target.version;
      if (!target.fromProcess) {
        const headers = await ensureOfficialNodeHeaders({
          version: target.version,
          cacheRoot: headersCacheRootFor(context),
          downloadToFile: context.downloadToFile,
          spawnSyncImpl: context.spawnSyncImpl,
        });
        if (!headers.ok) {
          return {
            enabled: true,
            isolated: [],
            skipped: [],
            failed: collectCandidates(context).map((candidate) => ({
              ...candidate,
              dest: isolatedPackageDir(candidate.nodeRoot, candidate.name, candidate.version),
              error: headers.error,
            })),
          };
        }
        nodeHeadersDir = headers.nodedir;
      }
    } catch (error) {
      return {
        enabled: true,
        isolated: [],
        skipped: [],
        failed: collectCandidates(context).map((candidate) => ({
          ...candidate,
          dest: isolatedPackageDir(candidate.nodeRoot, candidate.name, candidate.version),
          error: error?.message || String(error),
        })),
      };
    }
  }
  const rebuild = typeof context.rebuildPackage === 'function'
    ? context.rebuildPackage
    : (isolatedDir, candidate) => rebuildIsolatedNativePackageForNode({
      packageDir: isolatedDir,
      nodeBinary: runtime.nodeBinary,
      nodeHeadersDir,
      nodeTarget,
      extraBinDirs: [
        path.join(candidate.dir, 'node_modules', '.bin'),
        path.join(candidate.treeRoot, 'node_modules', '.bin'),
      ],
      spawnSyncImpl: context.spawnSyncImpl,
    });
  const isolated = [];
  const skipped = [];
  const failed = [];
  for (const candidate of collectCandidates(context)) {
    const dest = isolatedPackageDir(candidate.nodeRoot, candidate.name, candidate.version);
    if (isValidNodeCache(dest, candidate, runtime) && !context.forceRetryFailed) {
      skipped.push({ ...candidate, dest, reason: 'cache' });
      continue;
    }
    if (!context.forceRetryFailed && shouldSkipPreviousFailure(dest)) {
      failed.push({ ...candidate, dest, reason: 'previous-failure' });
      continue;
    }
    try {
      copyWholePackage(candidate.dir, dest);
      const rebuilt = await rebuild(dest, candidate, runtime);
      if (rebuilt?.ok) {
        writeStamp(dest, candidate, runtime, true);
        isolated.push({ ...candidate, dest, method: rebuilt.method || 'rebuild' });
      } else {
        writeStamp(dest, candidate, runtime, false, rebuilt?.error);
        failed.push({ ...candidate, dest, error: rebuilt?.error || 'rebuild failed' });
      }
    } catch (error) {
      try {
        writeStamp(dest, candidate, runtime, false, error?.message || error);
      } catch {
      }
      failed.push({ ...candidate, dest, error: error?.message || String(error) });
    }
  }
  return { enabled: true, isolated, skipped, failed };
};

const packageDirFromNodePath = (filePath) => {
  if (typeof filePath !== 'string' || !filePath) return '';
  let current = path.resolve(filePath);
  if (isFile(current)) current = path.dirname(current);
  while (current && current !== path.dirname(current)) {
    if (isFile(path.join(current, 'package.json'))) return current;
    current = path.dirname(current);
  }
  return '';
};

const readPackageIdentity = (packageDir) => {
  const pkg = readJsonObject(path.join(packageDir, 'package.json'));
  return {
    name: asText(pkg.name) || path.basename(packageDir),
    version: asText(pkg.version) || '0.0.0',
  };
};

export const isolatedNodePathForCliFile = (filePath, context = {}) => {
  if (typeof filePath !== 'string' || !filePath) return '';
  const resolved = realPath(filePath);
  const runtime = runtimeFromContext(context);
  for (const tree of listUserNodeTreeRoots({
    agentDir: context.agentDir,
    projectDir: context.projectDir,
    ...runtime,
  })) {
    const rel = path.relative(realPath(tree.root), resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const packageDir = packageDirFromNodePath(resolved);
    if (!packageDir) continue;
    const identity = readPackageIdentity(packageDir);
    const destRoot = isolatedPackageDir(tree.nodeRoot, identity.name, identity.version);
    if (!resolved.endsWith('.node')) return '';
    if (!isValidNodeCache(destRoot, identity, runtime)) return '';
    const remapped = path.join(destRoot, path.relative(realPath(packageDir), resolved));
    return isFile(remapped) ? remapped : '';
  }
  return '';
};

let uninstallNodeTreeRemap = null;

export const installUserExtensionNodeTreeRemap = (context = {}) => {
  if (uninstallNodeTreeRemap) return uninstallNodeTreeRemap;
  const originalResolve = Module._resolveFilename;
  const patchedResolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    const resolved = originalResolve.call(this, request, parent, isMain, options);
    const remapped = isolatedNodePathForCliFile(resolved, context);
    return remapped || resolved;
  };
  Module._resolveFilename = patchedResolveFilename;
  uninstallNodeTreeRemap = () => {
    if (Module._resolveFilename === patchedResolveFilename) {
      Module._resolveFilename = originalResolve;
    }
    uninstallNodeTreeRemap = null;
  };
  return uninstallNodeTreeRemap;
};
