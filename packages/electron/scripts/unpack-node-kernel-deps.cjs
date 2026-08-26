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

const normalizeAsarPath = (filePath) => String(filePath || '').replace(/^\//, '');

const packagePrefix = (name) => `node_modules/${name}`;

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const readAsarJson = (asarApi, archivePath, filePath) => {
  const candidates = [filePath, `/${filePath}`];
  for (const candidate of candidates) {
    try {
      return JSON.parse(asarApi.extractFile(archivePath, candidate).toString('utf8'));
    } catch {
      // try the next asar path shape
    }
  }
  return null;
};

const collectProductionPackageNames = ({
  resourcesPath,
  asarPath,
  asarApi,
  roots = KERNEL_ROOT_PACKAGES,
} = {}) => {
  const unpackedRoot = path.join(resourcesPath, 'app.asar.unpacked');
  const names = new Set();
  const queue = [...roots];

  while (queue.length) {
    const name = queue.pop();
    if (!name || names.has(name)) continue;
    names.add(name);
    const unpackedPkg = readJson(path.join(unpackedRoot, packagePrefix(name), 'package.json'));
    const packagedPkg = asarApi && asarPath
      ? readAsarJson(asarApi, asarPath, `${packagePrefix(name)}/package.json`)
      : null;
    const pkg = unpackedPkg || packagedPkg;
    if (!pkg || typeof pkg !== 'object') continue;
    for (const dep of Object.keys(pkg.dependencies || {})) {
      if (!names.has(dep)) queue.push(dep);
    }
  }

  return [...names].sort();
};

const listAsarFiles = (asarApi, archivePath) => {
  const listed = asarApi.listPackage(archivePath, { isPack: false });
  return Array.isArray(listed) ? listed.map(normalizeAsarPath) : [];
};

const extractPackageFromAsar = ({
  asarApi,
  asarPath,
  packageName,
  unpackedRoot,
} = {}) => {
  if (!asarApi || !asarPath || !packageName || !unpackedRoot) {
    throw new Error('asarApi, asarPath, packageName, and unpackedRoot are required');
  }
  const prefix = `${packagePrefix(packageName)}/`;
  const exact = packagePrefix(packageName);
  const files = listAsarFiles(asarApi, asarPath)
    .filter((filePath) => filePath === exact || filePath.startsWith(prefix));
  if (files.length === 0) return 0;

  let written = 0;
  for (const filePath of files) {
    const relative = filePath.slice('node_modules/'.length);
    const destination = path.join(unpackedRoot, 'node_modules', relative);
    const archiveNames = [filePath, `/${filePath}`];
    let extracted = null;
    for (const archiveName of archiveNames) {
      try {
        extracted = asarApi.extractFile(asarPath, archiveName);
        break;
      } catch {
        extracted = null;
      }
    }
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

const stagePackagedNodeKernelDeps = ({
  resourcesPath,
  requireAsar,
} = {}) => {
  if (!resourcesPath) throw new Error('resourcesPath is required');
  const asarPath = path.join(resourcesPath, 'app.asar');
  const unpackedRoot = path.join(resourcesPath, 'app.asar.unpacked');
  if (!fs.existsSync(asarPath) || !fs.existsSync(unpackedRoot)) {
    throw new Error(`Packaged app.asar and app.asar.unpacked are required under ${resourcesPath}`);
  }

  const asarApi = loadAsar({ requireAsar });
  const names = collectProductionPackageNames({ resourcesPath, asarPath, asarApi });
  const staged = [];
  for (const name of names) {
    const already = path.join(unpackedRoot, packagePrefix(name), 'package.json');
    if (fs.existsSync(already)) continue;
    const written = extractPackageFromAsar({
      asarApi,
      asarPath,
      packageName: name,
      unpackedRoot,
    });
    if (written > 0) staged.push(name);
  }
  return { names, staged };
};

module.exports = {
  KERNEL_ROOT_PACKAGES,
  collectProductionPackageNames,
  extractPackageFromAsar,
  stagePackagedNodeKernelDeps,
};
