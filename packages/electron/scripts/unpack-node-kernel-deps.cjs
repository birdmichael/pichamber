const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const KERNEL_ROOT_PACKAGES = Object.freeze([
  '@earendil-works/pi-coding-agent',
  'yaml',
]);

const loadAsar = ({ requireAsar } = {}) => {
  if (requireAsar) return requireAsar();
  try {
    return createRequire(require.resolve('electron-builder/package.json'))('@electron/asar');
  } catch {
    return require('@electron/asar');
  }
};

const normalizeAsarPath = (filePath) => String(filePath || '')
  .replace(/\\/g, '/')
  .replace(/^\//, '');

const packagePrefix = (name) => `node_modules/${name}`;

const unpackedPackageJson = (unpackedRoot, name) => path.join(
  unpackedRoot,
  'node_modules',
  name,
  'package.json',
);

const lastNodeModulesPackage = (filePath) => {
  const normalized = normalizeAsarPath(filePath);
  const re = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)(?=\/|$)/g;
  let last = null;
  let match;
  while ((match = re.exec(normalized)) !== null) {
    last = match[1];
  }
  return last;
};

const packageInteriorPath = (filePath, packageName) => {
  const normalized = normalizeAsarPath(filePath);
  if (lastNodeModulesPackage(normalized) !== packageName) return null;
  const marker = `node_modules/${packageName}`;
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return null;
  if (index > 0 && normalized[index - 1] !== '/') return null;
  const afterMarker = normalized[index + marker.length];
  if (afterMarker && afterMarker !== '/') return null;
  return normalized.slice(index + marker.length).replace(/^\//, '');
};

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const asarPathVariants = (filePath) => {
  const normalized = normalizeAsarPath(filePath);
  const backslash = normalized.replace(/\//g, '\\');
  return [...new Set([
    filePath,
    normalized,
    `/${normalized}`,
    backslash,
    `\\${backslash}`,
  ].filter((value) => value != null && value !== ''))];
};

const extractAsarFile = (asarApi, archivePath, filePath) => {
  for (const candidate of asarPathVariants(filePath)) {
    try {
      return asarApi.extractFile(archivePath, candidate);
    } catch {
      // try the next asar path shape
    }
  }
  return null;
};

const listAsarEntries = (asarApi, archivePath) => {
  if (!asarApi || typeof asarApi.listPackage !== 'function' || !archivePath) {
    return [];
  }
  const listed = asarApi.listPackage(archivePath, { isPack: false });
  if (!Array.isArray(listed)) return [];
  return listed.map((original) => ({
    original,
    normalized: normalizeAsarPath(original),
  }));
};

const readPackageJsonFromAsar = (asarApi, archivePath, packageName, listedEntries) => {
  if (!asarApi || !archivePath || !packageName) return null;
  const relative = `${packagePrefix(packageName)}/package.json`;
  const extracted = extractAsarFile(asarApi, archivePath, relative);
  if (extracted) {
    try {
      return JSON.parse(extracted.toString('utf8'));
    } catch {
      // fall through to listing
    }
  }

  const entries = listedEntries || listAsarEntries(asarApi, archivePath);
  for (const entry of entries) {
    if (packageInteriorPath(entry.normalized, packageName) !== 'package.json') continue;
    const nested = extractAsarFile(asarApi, archivePath, entry.original);
    if (!nested) continue;
    try {
      return JSON.parse(nested.toString('utf8'));
    } catch {
      // keep looking
    }
  }
  return null;
};

const collectProductionPackageNames = ({
  resourcesPath,
  asarPath,
  asarApi,
  roots = KERNEL_ROOT_PACKAGES,
  listedFiles,
} = {}) => {
  const unpackedRoot = path.join(resourcesPath, 'app.asar.unpacked');
  const names = new Set();
  const queue = [...roots];
  const listedEntries = Array.isArray(listedFiles) && listedFiles.length && typeof listedFiles[0] === 'string'
    ? listedFiles.map((original) => ({ original, normalized: normalizeAsarPath(original) }))
    : (listedFiles || listAsarEntries(asarApi, asarPath));

  while (queue.length) {
    const name = queue.pop();
    if (!name || names.has(name)) continue;
    names.add(name);
    const unpackedPkg = readJson(unpackedPackageJson(unpackedRoot, name));
    const packagedPkg = asarApi && asarPath
      ? readPackageJsonFromAsar(asarApi, asarPath, name, listedEntries)
      : null;
    const pkg = unpackedPkg || packagedPkg;
    if (!pkg || typeof pkg !== 'object') continue;
    for (const dep of Object.keys(pkg.dependencies || {})) {
      if (!names.has(dep)) queue.push(dep);
    }
  }

  return [...names].sort();
};

const extractPackageFromAsar = ({
  asarApi,
  asarPath,
  packageName,
  unpackedRoot,
  listedFiles,
} = {}) => {
  if (!asarApi || !asarPath || !packageName || !unpackedRoot) {
    throw new Error('asarApi, asarPath, packageName, and unpackedRoot are required');
  }
  const entries = listedFiles
    ? (typeof listedFiles[0] === 'string'
      ? listedFiles.map((original) => ({ original, normalized: normalizeAsarPath(original) }))
      : listedFiles)
    : listAsarEntries(asarApi, asarPath);
  const files = entries.filter((entry) => (
    packageInteriorPath(entry.normalized, packageName) != null
  ));
  if (files.length === 0) return 0;

  let written = 0;
  for (const entry of files) {
    const interior = packageInteriorPath(entry.normalized, packageName);
    const destination = interior
      ? path.join(unpackedRoot, 'node_modules', packageName, interior)
      : path.join(unpackedRoot, 'node_modules', packageName);
    const extracted = extractAsarFile(asarApi, asarPath, entry.original);
    if (extracted == null) {
      fs.mkdirSync(destination, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, extracted);
    written += 1;
  }
  return written;
};

const packageDirHasJson = (dir) => {
  try {
    return Boolean(dir) && fs.existsSync(path.join(dir, 'package.json'));
  } catch {
    return false;
  }
};

const resolvePackageFromNodeModules = (root, name) => {
  if (!root || !name) return null;
  const candidate = path.join(root, 'node_modules', name);
  return packageDirHasJson(candidate) ? candidate : null;
};

const resolvePackageWithRequire = (fromPackageJson, name) => {
  if (!fromPackageJson || !name || !fs.existsSync(fromPackageJson)) return null;
  try {
    const resolved = createRequire(fromPackageJson).resolve(`${name}/package.json`);
    const dir = path.dirname(resolved);
    return packageDirHasJson(dir) ? dir : null;
  } catch {
    return null;
  }
};

const resolvePackageDir = ({ name, searchRoots, unpackedRoot }) => {
  const roots = [...(searchRoots || [])].filter(Boolean);
  for (const root of roots) {
    const found = resolvePackageFromNodeModules(root, name);
    if (found) return found;
  }
  for (const root of roots) {
    const found = resolvePackageWithRequire(path.join(root, 'package.json'), name);
    if (found) return found;
  }

  const piPackageJsons = [
    unpackedPackageJson(unpackedRoot, '@earendil-works/pi-coding-agent'),
    ...roots.map((root) => path.join(
      root,
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'package.json',
    )),
  ];
  for (const piPkg of piPackageJsons) {
    const found = resolvePackageWithRequire(piPkg, name);
    if (found) return found;
  }
  return null;
};

const copyPackageFromDisk = (sourceDir, destDir) => {
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(sourceDir, destDir, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      if (src === sourceDir) return true;
      const relative = path.relative(sourceDir, src);
      if (!relative || relative.startsWith('..')) return true;
      return !relative.split(path.sep).includes('node_modules');
    },
  });
};

const stagePackagedNodeKernelDeps = ({
  resourcesPath,
  requireAsar,
  searchRoots = [],
} = {}) => {
  if (!resourcesPath) throw new Error('resourcesPath is required');
  const asarPath = path.join(resourcesPath, 'app.asar');
  const unpackedRoot = path.join(resourcesPath, 'app.asar.unpacked');
  if (!fs.existsSync(asarPath) || !fs.existsSync(unpackedRoot)) {
    throw new Error(`Packaged app.asar and app.asar.unpacked are required under ${resourcesPath}`);
  }

  const asarApi = loadAsar({ requireAsar });
  const listedEntries = listAsarEntries(asarApi, asarPath);
  const staged = [];
  const stagedSet = new Set();
  let previousKey = null;

  for (let round = 0; round < 50; round += 1) {
    const names = collectProductionPackageNames({
      resourcesPath,
      asarPath,
      asarApi,
      listedFiles: listedEntries,
    });
    const namesKey = names.join('\0');

    for (const name of names) {
      const pkgJson = unpackedPackageJson(unpackedRoot, name);
      if (fs.existsSync(pkgJson)) continue;

      extractPackageFromAsar({
        asarApi,
        asarPath,
        packageName: name,
        unpackedRoot,
        listedFiles: listedEntries,
      });
      if (fs.existsSync(pkgJson)) {
        if (!stagedSet.has(name)) {
          staged.push(name);
          stagedSet.add(name);
        }
        continue;
      }

      const sourceDir = resolvePackageDir({ name, searchRoots, unpackedRoot });
      if (sourceDir) {
        copyPackageFromDisk(sourceDir, path.join(unpackedRoot, 'node_modules', name));
      }
      if (fs.existsSync(pkgJson) && !stagedSet.has(name)) {
        staged.push(name);
        stagedSet.add(name);
      }
    }

    if (namesKey === previousKey) {
      const missing = names.filter((name) => !fs.existsSync(unpackedPackageJson(unpackedRoot, name)));
      if (missing.length > 0) {
        throw new Error(
          `Failed to unpack Pi kernel Node deps into app.asar.unpacked: ${missing.join(', ')}`,
        );
      }
      return { names, staged };
    }
    previousKey = namesKey;
  }

  throw new Error('Failed to unpack Pi kernel Node deps: dependency graph did not stabilize');
};

module.exports = {
  KERNEL_ROOT_PACKAGES,
  normalizeAsarPath,
  collectProductionPackageNames,
  extractPackageFromAsar,
  stagePackagedNodeKernelDeps,
};
