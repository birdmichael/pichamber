import Module from 'node:module';
import path from 'node:path';

const APP_OWNED_NATIVE_SEGMENT = `${path.sep}app.asar.unpacked${path.sep}`;
const USER_NPM_DIR = 'npm';
const USER_ELECTRON_NPM_DIR = 'npm-electron';
const PROJECT_PI_DIR = '.pi';

const MODULE_PATH_PATTERN = /The module ['"]([^'"]+\.node)['"]/i;
const COMPILER_ABI_PATTERN = /was compiled against a different Node\.js version using\s+NODE_MODULE_VERSION\s+(\d+)/i;
const LOADER_ABI_PATTERN = /This version of Node\.js requires\s+NODE_MODULE_VERSION\s+(\d+)/i;

let originalModuleLoad = null;
let originalResolveFilename = null;
const guardStack = [];

const asText = (value) => {
  if (typeof value === 'string') return value;
  if (!value) return '';
  if (typeof value.message === 'string' && value.message) return value.message;
  return String(value);
};

const asVersions = (versions) => (
  versions && typeof versions === 'object' ? versions : {}
);

export const isElectronProcess = (versions = process.versions) => {
  const electron = asVersions(versions).electron;
  return typeof electron === 'string' && electron.trim() !== '';
};

const loaderAbiFromVersions = (versions = process.versions) => {
  const modules = asVersions(versions).modules;
  return modules == null ? '' : String(modules);
};

const electronVersionFromVersions = (versions = process.versions) => {
  const electron = asVersions(versions).electron;
  return typeof electron === 'string' && electron.trim() ? electron.trim() : '';
};

const resolveExisting = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  return path.resolve(value);
};

export const listUserNpmTrees = ({ agentDir, projectDir } = {}) => {
  const trees = [];
  const agent = resolveExisting(agentDir);
  if (agent) {
    trees.push({
      root: path.join(agent, USER_NPM_DIR),
      scope: 'user',
      kind: 'cli',
    });
    trees.push({
      root: path.join(agent, USER_ELECTRON_NPM_DIR),
      scope: 'user',
      kind: 'electron',
    });
  }
  const project = resolveExisting(projectDir);
  if (project) {
    trees.push({
      root: path.join(project, PROJECT_PI_DIR, USER_NPM_DIR),
      scope: 'project',
      kind: 'cli',
    });
    trees.push({
      root: path.join(project, PROJECT_PI_DIR, USER_ELECTRON_NPM_DIR),
      scope: 'project',
      kind: 'electron',
    });
  }
  return trees;
};

const isPathInside = (parent, child) => {
  if (!parent || !child) return false;
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

export const isAppOwnedNativePath = (filePath) => {
  if (typeof filePath !== 'string' || !filePath) return false;
  const resolved = path.resolve(filePath);
  return resolved.includes(APP_OWNED_NATIVE_SEGMENT)
    || resolved.endsWith(`${path.sep}app.asar.unpacked`);
};

const findUserNpmTreeForPath = (filePath, trees) => {
  if (typeof filePath !== 'string' || !filePath || isAppOwnedNativePath(filePath)) {
    return null;
  }
  const resolved = path.resolve(filePath);
  for (const tree of trees || []) {
    if (tree?.root && isPathInside(tree.root, resolved)) {
      return tree;
    }
  }
  return null;
};

export const isUserNpmTreePath = (filePath, { agentDir, projectDir } = {}) => (
  Boolean(findUserNpmTreeForPath(filePath, listUserNpmTrees({ agentDir, projectDir })))
);

const packageNameFromNodeModulesRest = (rest) => {
  const parts = rest.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts[0].startsWith('@') && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
};

const packageNameFromElectronRest = (rest) => {
  const parts = rest.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return '';
  const runtime = parts[0];
  if (!runtime.startsWith('electron-')) return '';
  if (parts[1].startsWith('@') && parts[2]) {
    const scopedName = parts[2].replace(/@[^@]+$/, '');
    return scopedName ? `${parts[1]}/${scopedName}` : '';
  }
  return parts[1].replace(/@[^@]+$/, '');
};

export const userExtensionSourceFromPath = (filePath, trees) => {
  const tree = findUserNpmTreeForPath(filePath, trees);
  if (!tree) return '';
  const resolved = path.resolve(filePath);
  if (tree.kind === 'electron') {
    const name = packageNameFromElectronRest(path.relative(tree.root, resolved));
    return name ? `npm:${name}` : tree.root;
  }
  const nodeModulesRoot = path.join(tree.root, 'node_modules');
  if (isPathInside(nodeModulesRoot, resolved)) {
    const rest = path.relative(nodeModulesRoot, resolved);
    const name = packageNameFromNodeModulesRest(rest);
    return name ? `npm:${name}` : tree.root;
  }
  return tree.root;
};

export const parseNativeAbiMismatch = (error) => {
  const text = asText(error);
  if (!text) return null;
  const compilerMatch = text.match(COMPILER_ABI_PATTERN);
  const loaderMatch = text.match(LOADER_ABI_PATTERN);
  if (!compilerMatch || !loaderMatch) return null;
  const pathMatch = text.match(MODULE_PATH_PATTERN);
  return {
    nodePath: pathMatch?.[1] || '',
    compilerAbi: compilerMatch[1],
    parsedLoaderAbi: loaderMatch[1],
  };
};

export const formatNativeAbiMismatchError = ({
  nodePath,
  compilerAbi,
  loaderAbi,
} = {}) => (
  `The module '${nodePath}'\n`
  + 'was compiled against a different Node.js version using\n'
  + `NODE_MODULE_VERSION ${compilerAbi}. This version of Node.js requires\n`
  + `NODE_MODULE_VERSION ${loaderAbi}.\n`
  + 'Please try re-compiling or re-installing the module\n'
  + '(for instance, using `npm rebuild` or `npm install`).'
);

const skipKey = (diagnostic) => (
  [diagnostic.source, diagnostic.nodePath, diagnostic.tree].filter(Boolean).join('\0')
);

export const createUserExtensionNativeSkipStore = () => {
  const byKey = new Map();
  return {
    remember(diagnostic) {
      if (!diagnostic || typeof diagnostic !== 'object') return diagnostic;
      const key = skipKey(diagnostic);
      if (!key) return diagnostic;
      const previous = byKey.get(key);
      byKey.set(key, diagnostic);
      return { diagnostic, first: !previous };
    },
    list() {
      return Array.from(byKey.values());
    },
    clear() {
      byKey.clear();
    },
  };
};

export const classifyUserExtensionNativeFailure = (error, {
  agentDir,
  projectDir,
  versions = process.versions,
  extensionPath,
} = {}) => {
  if (!isElectronProcess(versions)) return null;
  const parsed = parseNativeAbiMismatch(error);
  if (!parsed) return null;

  const trees = listUserNpmTrees({ agentDir, projectDir });
  const candidatePaths = [parsed.nodePath, extensionPath];
  let tree = null;
  let nodePath = parsed.nodePath;
  for (const candidate of candidatePaths) {
    const match = findUserNpmTreeForPath(candidate, trees);
    if (match) {
      tree = match;
      if (!nodePath && candidate) nodePath = candidate;
      break;
    }
  }
  if (!tree) return null;

  const source = userExtensionSourceFromPath(nodePath || extensionPath, trees)
    || userExtensionSourceFromPath(extensionPath, trees);
  if (!source) return null;

  return {
    source,
    nodePath: nodePath || parsed.nodePath || '',
    extensionPath: typeof extensionPath === 'string' ? extensionPath : '',
    tree: tree.scope,
    loaderAbi: loaderAbiFromVersions(versions) || parsed.parsedLoaderAbi,
    compilerAbi: parsed.compilerAbi,
    electronVersion: electronVersionFromVersions(versions),
  };
};

export const collectSkippedUserExtensionsFromErrors = (errors, context) => {
  const skipped = [];
  for (const item of Array.isArray(errors) ? errors : []) {
    const errorText = typeof item === 'string'
      ? item
      : (item?.error || item?.message || item);
    const classified = classifyUserExtensionNativeFailure(errorText, {
      ...context,
      extensionPath: item?.path || context?.extensionPath,
    });
    if (classified) skipped.push(classified);
  }
  return skipped;
};

const currentGuard = () => guardStack[guardStack.length - 1] || null;

const defaultLoadModule = function defaultLoadModule(request, parent, isMain, originalLoad) {
  return originalLoad.call(this, request, parent, isMain);
};

const loadThrough = function loadThrough(guard, request, parent, isMain) {
  const loadModule = guard?.loadModule || defaultLoadModule;
  const originalLoad = originalModuleLoad || Module._load;
  return loadModule.call(this, request, parent, isMain, originalLoad);
};

const rememberFailure = (guard, error, request) => {
  if (!guard?.store) return;
  const classified = classifyUserExtensionNativeFailure(error, {
    ...guard.context,
    extensionPath: typeof request === 'string' ? request : guard.context.extensionPath,
  });
  if (classified) {
    guard.store.remember(classified);
  }
};

const patchedModuleLoad = function patchedModuleLoad(request, parent, isMain) {
  const guard = currentGuard();
  const originalResolve = originalResolveFilename || Module._resolveFilename;
  const remap = typeof guard?.remapLoad === 'function'
    ? guard.remapLoad(request, parent, (nextRequest, nextParent) => (
      originalResolve.call(Module, nextRequest, nextParent, false)
    ))
    : null;
  const primary = remap?.preferIsolated ? remap.isolatedRequest : request;
  try {
    return loadThrough.call(this, guard, primary, parent, isMain);
  } catch (error) {
    if (
      remap?.fallbackRequest
      && primary !== remap.fallbackRequest
      && parseNativeAbiMismatch(error)
    ) {
      try {
        return loadThrough.call(this, guard, remap.fallbackRequest, parent, isMain);
      } catch (isolatedError) {
        if (typeof guard?.captureLazyNative === 'function') {
          guard.captureLazyNative(isolatedError, request, parent);
        }
        rememberFailure(guard, isolatedError, remap.fallbackRequest);
        throw isolatedError;
      }
    }
    if (typeof guard?.captureLazyNative === 'function') {
      guard.captureLazyNative(error, request, parent);
    }
    rememberFailure(guard, error, request);
    throw error;
  }
};

const patchedResolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  const guard = currentGuard();
  const originalResolve = originalResolveFilename || Module._resolveFilename;
  try {
    return originalResolve.call(this, request, parent, isMain, options);
  } catch (error) {
    if (typeof guard?.resolveFilenameFallback === 'function') {
      const fallback = guard.resolveFilenameFallback(
        request,
        parent,
        (nextRequest, nextParent) => originalResolve.call(this, nextRequest, nextParent, false),
      );
      if (fallback) return fallback;
    }
    throw error;
  }
};

const installModuleLoadPatch = () => {
  if (originalModuleLoad) return;
  originalModuleLoad = Module._load;
  originalResolveFilename = Module._resolveFilename;
  Module._load = patchedModuleLoad;
  Module._resolveFilename = patchedResolveFilename;
};

const uninstallModuleLoadPatch = () => {
  if (!originalModuleLoad) return;
  if (Module._load === patchedModuleLoad) {
    Module._load = originalModuleLoad;
  }
  if (originalResolveFilename && Module._resolveFilename === patchedResolveFilename) {
    Module._resolveFilename = originalResolveFilename;
  }
  originalModuleLoad = null;
  originalResolveFilename = null;
};

export const withUserExtensionNativeGuard = async (options, operation) => {
  const context = {
    agentDir: options?.agentDir,
    projectDir: options?.projectDir,
    versions: options?.versions || process.versions,
    extensionPath: options?.extensionPath,
  };
  const enabled = isElectronProcess(context.versions);
  if (!enabled) {
    return operation({ enabled: false, store: options?.store });
  }

  const store = options?.store || createUserExtensionNativeSkipStore();
  const entry = {
    context,
    store,
    loadModule: typeof options?.loadModule === 'function' ? options.loadModule : defaultLoadModule,
    remapLoad: typeof options?.remapLoad === 'function' ? options.remapLoad : null,
    captureLazyNative: typeof options?.captureLazyNative === 'function' ? options.captureLazyNative : null,
    resolveFilenameFallback: typeof options?.resolveFilenameFallback === 'function'
      ? options.resolveFilenameFallback
      : null,
  };
  installModuleLoadPatch();
  guardStack.push(entry);
  try {
    return await operation({ enabled: true, store });
  } finally {
    const index = guardStack.lastIndexOf(entry);
    if (index >= 0) guardStack.splice(index, 1);
    if (guardStack.length === 0) {
      uninstallModuleLoadPatch();
    }
  }
};

export const rememberSkippedUserExtensions = (store, diagnostics, onFirst) => {
  if (!store || typeof store.remember !== 'function') return;
  for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
    const remembered = store.remember(diagnostic);
    if (remembered?.first && typeof onFirst === 'function') {
      onFirst(remembered.diagnostic);
    }
  }
};
