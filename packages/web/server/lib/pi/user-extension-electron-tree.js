import fs from 'node:fs';
import path from 'node:path';

import {
  isElectronProcess,
  listUserNpmTrees,
  parseNativeAbiMismatch,
} from './user-extension-native.js';
import { rebuildIsolatedNativePackageInChild } from './user-extension-electron-rebuild.js';

const ELECTRON_PREFIX = 'npm-electron';
const STAMP_NAME = '.pichamber-electron.json';
const NATIVE_TOOL_SCRIPT = /node-gyp(?:-build)?|prebuild-install|prebuildify|node-pre-gyp/i;
const NATIVE_TOOL_DEP = new Set([
  'bindings',
  'cmake-js',
  'node-addon-api',
  'node-gyp',
  'node-gyp-build',
  'node-pre-gyp',
  '@mapbox/node-pre-gyp',
  'prebuild-install',
  'prebuildify',
]);

const lazyCandidates = new Map();

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const asVersions = (versions) => (
  versions && typeof versions === 'object' ? versions : {}
);

const readJsonObject = (filePath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

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

export const electronRuntimeKey = ({
  versions = process.versions,
  platform = process.platform,
  arch = process.arch,
} = {}) => {
  const modules = asVersions(versions).modules;
  return `electron-${modules == null ? '' : String(modules)}-${platform}-${arch}`;
};

export const electronTreeRootForNpm = (npmRoot, runtime = {}) => (
  path.join(path.dirname(npmRoot), ELECTRON_PREFIX, electronRuntimeKey(runtime))
);

export const isolatedPackageDir = (treeRoot, name, version) => (
  path.join(treeRoot, `${name}@${version}`)
);

const npmRootFromTree = (tree) => tree?.root || '';

const listUserElectronTreeRoots = ({
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
      electronRoot: electronTreeRootForNpm(tree.root, { versions, platform, arch }),
    }))
);

const packageJsonPath = (dir) => path.join(dir, 'package.json');

const readPackageIdentity = (packageDir) => {
  const pkg = readJsonObject(packageJsonPath(packageDir));
  const name = asText(pkg.name) || path.basename(packageDir);
  const version = asText(pkg.version) || '0.0.0';
  return { name, version, pkg };
};

const dependencyNames = (pkg) => {
  const names = [];
  for (const field of ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies']) {
    const record = pkg?.[field];
    if (record && typeof record === 'object') {
      names.push(...Object.keys(record));
    }
  }
  return names;
};

const scriptText = (pkg) => {
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  return ['install', 'postinstall', 'preinstall', 'rebuild', 'prebuild']
    .map((key) => asText(scripts[key]))
    .filter(Boolean)
    .join('\n');
};

const packageHasNapiMetadata = (packageDir) => {
  const { pkg } = readPackageIdentity(packageDir);
  if (pkg.napi != null) return true;
  if (pkg.binary && typeof pkg.binary === 'object' && pkg.binary.napi_versions) return true;
  return dependencyNames(pkg).includes('node-addon-api');
};

const isNativePackageJsonMetadata = (pkg) => {
  if (!pkg || typeof pkg !== 'object') return false;
  if (pkg.gypfile === true) return true;
  if (pkg.binary && typeof pkg.binary === 'object') return true;
  if (pkg.napi != null) return true;
  if (NATIVE_TOOL_SCRIPT.test(scriptText(pkg))) return true;
  return dependencyNames(pkg).some((name) => NATIVE_TOOL_DEP.has(name));
};

export const isNativePackageCandidate = (packageDir) => {
  if (!isDirectory(packageDir) || !isFile(packageJsonPath(packageDir))) return false;
  if (isFile(path.join(packageDir, 'binding.gyp'))) return true;
  if (isDirectory(path.join(packageDir, 'prebuilds'))) return true;
  return isNativePackageJsonMetadata(readJsonObject(packageJsonPath(packageDir)));
};

const listPackageDirs = (nodeModulesDir) => {
  const dirs = [];
  if (!isDirectory(nodeModulesDir)) return dirs;
  let entries = [];
  try {
    entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return dirs;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name === '.bin' || entry.name === '.package-lock.json') continue;
    const full = path.join(nodeModulesDir, entry.name);
    if (entry.name.startsWith('@')) {
      let scoped = [];
      try {
        scoped = fs.readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of scoped) {
        if (!child.isDirectory() && !child.isSymbolicLink()) continue;
        dirs.push(path.join(full, child.name));
      }
      continue;
    }
    dirs.push(full);
  }
  return dirs;
};

const walkNodeModules = (nodeModulesDir, visit, seen = new Set()) => {
  const resolved = path.resolve(nodeModulesDir);
  if (seen.has(resolved)) return;
  seen.add(resolved);
  for (const packageDir of listPackageDirs(nodeModulesDir)) {
    visit(packageDir);
    walkNodeModules(path.join(packageDir, 'node_modules'), visit, seen);
  }
};

export const discoverNativePackageCandidates = (npmRoot) => {
  const candidates = [];
  const seen = new Set();
  walkNodeModules(path.join(npmRoot, 'node_modules'), (packageDir) => {
    if (!isNativePackageCandidate(packageDir)) return;
    const identity = readPackageIdentity(packageDir);
    const key = `${identity.name}@${identity.version}\0${path.resolve(packageDir)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      dir: path.resolve(packageDir),
      name: identity.name,
      version: identity.version,
      napi: packageHasNapiMetadata(packageDir),
    });
  });
  return candidates;
};

const lazyKey = (candidate) => (
  [candidate.treeRoot, candidate.name, candidate.version].join('\0')
);

export const rememberLazyNativeCandidate = (candidate) => {
  if (!candidate?.dir || !candidate.name) return candidate;
  const next = {
    dir: path.resolve(candidate.dir),
    name: candidate.name,
    version: candidate.version || '0.0.0',
    treeRoot: candidate.treeRoot || '',
    napi: Boolean(candidate.napi),
    lazy: true,
  };
  lazyCandidates.set(lazyKey(next), next);
  return next;
};

export const listLazyNativeCandidates = () => Array.from(lazyCandidates.values());

export const clearLazyNativeCandidates = () => {
  lazyCandidates.clear();
};

const packageDirFromNodePath = (filePath) => {
  if (typeof filePath !== 'string' || !filePath) return '';
  let current = path.resolve(filePath);
  if (isFile(current)) current = path.dirname(current);
  while (current && current !== path.dirname(current)) {
    if (isFile(packageJsonPath(current))) return current;
    current = path.dirname(current);
  }
  return '';
};

const readElectronStamp = (isolatedDir) => {
  const stamp = readJsonObject(path.join(isolatedDir, STAMP_NAME));
  return stamp && typeof stamp === 'object' ? stamp : null;
};

export const isValidElectronCache = (isolatedDir, candidate, runtime) => {
  if (!isDirectory(isolatedDir) || !isFile(packageJsonPath(isolatedDir))) return false;
  const stamp = readElectronStamp(isolatedDir);
  if (!stamp || stamp.ok !== true) return false;
  const key = electronRuntimeKey(runtime);
  return stamp.name === candidate.name
    && stamp.version === candidate.version
    && stamp.runtime === key;
};

const writeStamp = (isolatedDir, candidate, runtime, ok, error) => {
  fs.writeFileSync(path.join(isolatedDir, STAMP_NAME), `${JSON.stringify({
    ok: Boolean(ok),
    name: candidate.name,
    version: candidate.version,
    runtime: electronRuntimeKey(runtime),
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

const runtimeFromContext = (context) => ({
  versions: context?.versions || process.versions,
  platform: context?.platform || process.platform,
  arch: context?.arch || process.arch,
});

const collectCandidates = (context) => {
  const runtime = runtimeFromContext(context);
  const found = [];
  const seen = new Set();
  for (const tree of listUserElectronTreeRoots({
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
        electronRoot: tree.electronRoot,
        scope: tree.scope,
      });
    }
  }
  for (const lazy of listLazyNativeCandidates()) {
    const tree = listUserElectronTreeRoots({
      agentDir: context?.agentDir,
      projectDir: context?.projectDir,
      ...runtime,
    }).find((item) => lazy.dir.startsWith(`${item.root}${path.sep}`) || lazy.treeRoot === item.root);
    if (!tree) continue;
    const key = `${tree.root}\0${lazy.name}@${lazy.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      ...lazy,
      treeRoot: tree.root,
      electronRoot: tree.electronRoot,
      scope: tree.scope,
    });
  }
  return found;
};

export const syncUserExtensionElectronTree = async (context = {}) => {
  if (!isElectronProcess(context.versions || process.versions)) {
    return { enabled: false, isolated: [], skipped: [], failed: [] };
  }
  const runtime = runtimeFromContext(context);
  const rebuild = typeof context.rebuildPackage === 'function'
    ? context.rebuildPackage
    : (isolatedDir) => rebuildIsolatedNativePackageInChild({
      packageDir: isolatedDir,
      versions: runtime.versions,
      platform: runtime.platform,
      arch: runtime.arch,
      spawnImpl: context.spawnImpl,
    });
  const isolated = [];
  const skipped = [];
  const failed = [];
  for (const candidate of collectCandidates(context)) {
    const dest = isolatedPackageDir(candidate.electronRoot, candidate.name, candidate.version);
    if (isValidElectronCache(dest, candidate, runtime) && !context.forceRetryFailed) {
      skipped.push({ ...candidate, dest, reason: 'cache' });
      continue;
    }
    if (!context.forceRetryFailed && readElectronStamp(dest)?.ok === false) {
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

export const isolatedPathForCliFile = (filePath, context = {}) => {
  if (typeof filePath !== 'string' || !filePath) return '';
  const resolved = path.resolve(filePath);
  const runtime = runtimeFromContext(context);
  for (const tree of listUserElectronTreeRoots({
    agentDir: context.agentDir,
    projectDir: context.projectDir,
    ...runtime,
  })) {
    const rel = path.relative(tree.root, resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const packageDir = packageDirFromNodePath(resolved);
    if (!packageDir) continue;
    const identity = readPackageIdentity(packageDir);
    const destRoot = isolatedPackageDir(tree.electronRoot, identity.name, identity.version);
    if (!isValidElectronCache(destRoot, identity, runtime)) return '';
    return path.join(destRoot, path.relative(packageDir, resolved));
  }
  return '';
};

const remapResolvedResourcePaths = (resolved, context = {}) => {
  if (!resolved || typeof resolved !== 'object') return resolved;
  const remapList = (items) => (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item.path !== 'string') return item;
    const packageDir = packageDirFromNodePath(item.path);
    if (!packageDir || packageHasNapiMetadata(packageDir)) return item;
    const remapped = isolatedPathForCliFile(item.path, context);
    return remapped ? { ...item, path: remapped } : item;
  });
  return {
    ...resolved,
    extensions: remapList(resolved.extensions),
  };
};

export const wrapPackageManagerWithElectronNativeTree = (manager, context = {}) => {
  if (!manager || typeof manager !== 'object') return manager;
  if (!isElectronProcess(context.versions || process.versions)) return manager;
  const syncAfter = async (result) => {
    try {
      await syncUserExtensionElectronTree({
        ...context,
        forceRetryFailed: true,
      });
    } catch {
    }
    return result;
  };
  return new Proxy(manager, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'install' || prop === 'installAndPersist' || prop === 'update') {
        return async (...args) => syncAfter(await value.apply(target, args));
      }
      if (prop === 'resolve') {
        return async (...args) => remapResolvedResourcePaths(await value.apply(target, args), context);
      }
      return value.bind(target);
    },
  });
};

const tryResolveFilename = (request, parent, resolveImpl) => {
  if (typeof resolveImpl === 'function') {
    try {
      return resolveImpl(request, parent);
    } catch {
      return '';
    }
  }
  return typeof request === 'string' ? request : '';
};

export const createElectronTreeLoadHelpers = (context = {}) => {
  const runtime = runtimeFromContext(context);
  return {
    remapLoad(request, parent, resolveImpl) {
      const resolved = tryResolveFilename(request, parent, resolveImpl)
        || (typeof request === 'string' && path.isAbsolute(request) ? request : '');
      if (!resolved) return null;
      const remapped = isolatedPathForCliFile(resolved, { ...context, ...runtime });
      if (!remapped) return null;
      const packageDir = packageDirFromNodePath(resolved);
      return {
        isolatedRequest: remapped,
        preferIsolated: packageDir ? !packageHasNapiMetadata(packageDir) : true,
        fallbackRequest: remapped,
        sourcePath: resolved,
      };
    },
    resolveFilenameFallback(request, parent, resolveImpl) {
      const filename = parent?.filename || parent?.id;
      if (typeof filename !== 'string' || !filename.includes(`${path.sep}${ELECTRON_PREFIX}${path.sep}`)) {
        return '';
      }
      const trees = listUserElectronTreeRoots({
        agentDir: context.agentDir,
        projectDir: context.projectDir,
        ...runtime,
      });
      const tree = trees.find((item) => filename.startsWith(`${item.electronRoot}${path.sep}`));
      if (!tree) return '';
      const rest = path.relative(tree.electronRoot, filename);
      const packageDirName = rest.split(path.sep)[0];
      const match = packageDirName?.match(/^(.*)@([^@]+)$/);
      if (!match) return '';
      const cliPackage = path.join(tree.root, 'node_modules', match[1]);
      if (!isDirectory(cliPackage)) return '';
      const fakeParent = {
        ...parent,
        filename: path.join(cliPackage, path.relative(path.join(tree.electronRoot, packageDirName), filename)),
      };
      return tryResolveFilename(request, fakeParent, resolveImpl);
    },
    captureLazyNative(error, request, parent) {
      const parsed = parseNativeAbiMismatch(error);
      const candidatePath = parsed?.nodePath
        || (typeof request === 'string' ? request : '')
        || parent?.filename;
      const packageDir = packageDirFromNodePath(candidatePath);
      if (!packageDir) return null;
      const trees = listUserNpmTrees({
        agentDir: context.agentDir,
        projectDir: context.projectDir,
      }).filter((tree) => tree.kind === 'cli');
      const tree = trees.find((item) => packageDir.startsWith(`${item.root}${path.sep}`));
      if (!tree) return null;
      const identity = readPackageIdentity(packageDir);
      return rememberLazyNativeCandidate({
        ...identity,
        dir: packageDir,
        treeRoot: tree.root,
        napi: packageHasNapiMetadata(packageDir),
      });
    },
  };
};
