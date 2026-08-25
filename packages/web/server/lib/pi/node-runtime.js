import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PI_NODE_UNAVAILABLE_CODE = 'PI_NODE_UNAVAILABLE';
export const PI_SDK_UNAVAILABLE_CODE = 'PI_SDK_UNAVAILABLE';
export const PI_SDK_PACKAGE = '@earendil-works/pi-coding-agent';

const NODE_NAMES = new Set(['node', 'node.exe']);
const REJECTED_NAMES = new Set(['pi', 'pi.exe', 'electron', 'electron.exe', 'pichamber', 'pichamber.exe', 'bun', 'bun.exe']);

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const basenameOf = (filePath) => path.basename(filePath || '').toLowerCase();

const isFile = (filePath) => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const isExecutableFile = (filePath) => {
  if (!filePath || !isFile(filePath)) return false;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return process.platform === 'win32' && isFile(filePath);
  }
};

const isNodeExecutableName = (filePath) => NODE_NAMES.has(basenameOf(filePath));

const isRejectedKernelBinaryName = (filePath) => REJECTED_NAMES.has(basenameOf(filePath));

const isElectronProcess = (versions = process.versions) => {
  const electron = versions && typeof versions === 'object' ? versions.electron : '';
  return typeof electron === 'string' && electron.trim() !== '';
};

export const shouldUseNodeKernel = ({
  env = process.env,
  versions = process.versions,
  mock = false,
  useNodeKernel,
} = {}) => {
  if (useNodeKernel === true) return true;
  if (useNodeKernel === false) return false;
  const flag = asText(env?.OPENCHAMBER_PI_NODE_KERNEL).toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  if (flag === '1' || flag === 'true' || flag === 'on') return true;
  if (mock) return false;
  return isElectronProcess(versions);
};

export const toNodeReadablePath = (filePath) => {
  const value = asText(filePath);
  if (!value) return '';
  const needle = `${path.sep}app.asar${path.sep}`;
  if (!value.includes(needle)) return value;
  return value.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
};

const bundledNodeCandidates = ({ env = process.env, resourcesPath, platform = process.platform } = {}) => {
  const names = platform === 'win32' ? ['node.exe'] : ['node'];
  const roots = [
    asText(env?.PICHAMBER_BUNDLED_NODE),
    asText(env?.OPENCHAMBER_BUNDLED_NODE),
    resourcesPath ? path.join(resourcesPath, 'node', 'bin') : '',
    resourcesPath ? path.join(resourcesPath, 'node') : '',
  ].filter(Boolean);
  const out = [];
  for (const root of roots) {
    if (isNodeExecutableName(root) || root.toLowerCase().endsWith('.exe')) {
      out.push(root);
      continue;
    }
    for (const name of names) {
      out.push(path.join(root, name));
    }
  }
  return out;
};

const searchPathForNode = ({ env = process.env, platform = process.platform } = {}) => {
  const pathValue = asText(env?.PATH || env?.Path);
  if (!pathValue) return '';
  const names = platform === 'win32' ? ['node.exe', 'node'] : ['node'];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate) && isNodeExecutableName(candidate)) {
        return path.resolve(candidate);
      }
    }
  }
  return '';
};

const wellKnownNodePaths = ({ platform = process.platform } = {}) => {
  if (platform === 'win32') return [];
  return [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    '/bin/node',
  ];
};

export const createMissingNodeError = (runtime) => {
  const error = new Error(runtime?.message || 'Desktop could not find a Node.js binary for the Pi kernel.');
  error.status = 503;
  error.code = PI_NODE_UNAVAILABLE_CODE;
  error.recovery = runtime?.recovery || missingNodeRecovery();
  return error;
};

const missingNodeRecovery = () => (
  'Install a Node.js that can load the app Pi SDK, or set PICHAMBER_NODE_BINARY to that executable, then reload Pi. '
  + 'Desktop will not start a half-ready kernel, and it will not load user extensions inside Electron.'
);

const sdkUnavailableRecovery = () => (
  'Install a Node.js that can load the app Pi SDK, or set PICHAMBER_NODE_BINARY to that executable, then reload Pi. '
  + 'Desktop will not start a mock or half-ready kernel.'
);

export const createSdkUnavailableError = (detail) => {
  const sdkError = typeof detail?.sdk?.error === 'string' ? detail.sdk.error : '';
  const message = sdkError
    || detail?.message
    || 'The resolved Node.js binary could not load the app-bundled Pi SDK.';
  const error = new Error(message);
  error.status = 503;
  error.code = PI_SDK_UNAVAILABLE_CODE;
  error.recovery = sdkUnavailableRecovery();
  return error;
};

export const isSdkHelloReady = (hello) => {
  const sdk = hello?.sdk;
  if (!sdk || typeof sdk !== 'object') return false;
  if (asText(sdk.error)) return false;
  return Boolean(asText(sdk.package) && asText(sdk.version) && asText(sdk.packagePath));
};

export const describeNodeKernelFailure = (runtime) => {
  if (!runtime?.ok) {
    return {
      code: runtime?.code || PI_NODE_UNAVAILABLE_CODE,
      message: asText(runtime?.message) || 'Desktop could not find a Node.js binary for the Pi kernel.',
      recovery: asText(runtime?.recovery) || missingNodeRecovery(),
    };
  }
  if (runtime.hello && !isSdkHelloReady(runtime.hello)) {
    const sdkError = asText(runtime.hello?.sdk?.error);
    return {
      code: PI_SDK_UNAVAILABLE_CODE,
      message: sdkError || 'The resolved Node.js binary could not load the app-bundled Pi SDK.',
      recovery: sdkUnavailableRecovery(),
    };
  }
  return null;
};

const toFilesystemPath = (value) => {
  const text = asText(value);
  if (!text) return '';
  if (text.startsWith('file:')) {
    try {
      return fileURLToPath(text);
    } catch {
      return '';
    }
  }
  return path.isAbsolute(text) ? text : '';
};

const readNamedPackage = (dir, packageName, { readFileImpl, existsImpl }) => {
  const candidate = path.join(dir, 'package.json');
  if (!existsImpl(candidate)) return null;
  try {
    const pkg = JSON.parse(readFileImpl(candidate, 'utf8'));
    if (pkg?.name !== packageName) return null;
    return {
      package: packageName,
      version: typeof pkg.version === 'string' ? pkg.version.trim() : '',
      packagePath: candidate,
    };
  } catch {
    return null;
  }
};

const findNamedPackageFromModulePath = (modulePath, packageName, io = {}) => {
  const readFileImpl = io.readFileImpl || fs.readFileSync;
  const existsImpl = io.existsImpl || fs.existsSync;
  let current = toFilesystemPath(modulePath);
  if (!current) return null;
  if (path.basename(current) === 'package.json') {
    current = path.dirname(current);
  } else if (existsImpl(current) && isFile(current)) {
    current = path.dirname(current);
  }
  while (current && current !== path.dirname(current)) {
    const found = readNamedPackage(current, packageName, { readFileImpl, existsImpl });
    if (found) return found;
    current = path.dirname(current);
  }
  return null;
};

const resolveSdkModuleUrl = (packageName, resolveImpl) => {
  if (typeof resolveImpl === 'function') {
    return String(resolveImpl(packageName) || '');
  }
  if (typeof import.meta.resolve === 'function') {
    return String(import.meta.resolve(packageName));
  }
  throw new Error(`import.meta.resolve is not available for ${packageName}`);
};

export const resolveInstalledPiSdkInfo = async ({
  packageName = PI_SDK_PACKAGE,
  importImpl,
  resolveImpl,
  readFileImpl = fs.readFileSync,
  existsImpl = fs.existsSync,
} = {}) => {
  try {
    if (typeof importImpl === 'function') {
      await importImpl(packageName);
    } else {
      await import(packageName);
    }
  } catch (error) {
    return {
      package: packageName,
      version: '',
      packagePath: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let modulePath = '';
  try {
    modulePath = resolveSdkModuleUrl(packageName, resolveImpl);
  } catch (error) {
    return {
      package: packageName,
      version: '',
      packagePath: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const found = findNamedPackageFromModulePath(modulePath, packageName, { readFileImpl, existsImpl });
  if (!found || !asText(found.version) || !asText(found.packagePath)) {
    return {
      package: packageName,
      version: found?.version || '',
      packagePath: found?.packagePath || '',
      error: `Resolved ${packageName} but could not locate its package.json`,
    };
  }
  return found;
};

const acceptNodeBinary = (candidate, { allowCurrentElectron = false, versions = process.versions } = {}) => {
  const filePath = asText(candidate);
  if (!filePath || !isExecutableFile(filePath)) return '';
  if (isRejectedKernelBinaryName(filePath) && !isNodeExecutableName(filePath)) {
    return '';
  }
  if (
    !allowCurrentElectron
    && isElectronProcess(versions)
    && filePath === process.execPath
    && !isNodeExecutableName(filePath)
  ) {
    return '';
  }
  if (isNodeExecutableName(filePath)) return path.resolve(filePath);
  return '';
};

export const resolvePiNodeRuntime = ({
  env = process.env,
  versions = process.versions,
  execPath = process.execPath,
  platform = process.platform,
  resourcesPath,
  nodeBinary,
} = {}) => {
  const explicit = [
    nodeBinary,
    env?.PICHAMBER_NODE_BINARY,
    env?.OPENCHAMBER_NODE_BINARY,
  ];
  for (const candidate of explicit) {
    const resolved = acceptNodeBinary(candidate, { versions });
    if (resolved) {
      return {
        ok: true,
        command: resolved,
        source: 'override',
        recovery: '',
      };
    }
    if (asText(candidate) && isRejectedKernelBinaryName(candidate)) {
      return {
        ok: false,
        code: PI_NODE_UNAVAILABLE_CODE,
        message: `PICHAMBER_NODE_BINARY must be a Node.js binary, not ${path.basename(candidate)}.`,
        recovery: missingNodeRecovery(),
      };
    }
  }

  for (const candidate of bundledNodeCandidates({ env, resourcesPath, platform })) {
    const resolved = acceptNodeBinary(candidate, { versions });
    if (resolved) {
      return {
        ok: true,
        command: resolved,
        source: 'bundled',
        recovery: '',
      };
    }
  }

  const systemNode = searchPathForNode({ env, platform });
  if (systemNode) {
    return {
      ok: true,
      command: systemNode,
      source: 'system',
      recovery: '',
    };
  }
  for (const candidate of wellKnownNodePaths({ platform })) {
    const resolved = acceptNodeBinary(candidate, { versions });
    if (resolved) {
      return {
        ok: true,
        command: resolved,
        source: 'system',
        recovery: '',
      };
    }
  }

  if (!isElectronProcess(versions) && isNodeExecutableName(execPath)) {
    const resolved = acceptNodeBinary(execPath, { versions, allowCurrentElectron: true });
    if (resolved) {
      return {
        ok: true,
        command: resolved,
        source: 'current',
        recovery: '',
      };
    }
  }

  return {
    ok: false,
    code: PI_NODE_UNAVAILABLE_CODE,
    message: 'Desktop could not find a Node.js binary to load user Pi extensions.',
    recovery: missingNodeRecovery(),
  };
};

export const childPathEnvForNode = (nodeBinary, env = process.env) => {
  const command = asText(nodeBinary);
  const current = asText(env?.PATH || env?.Path);
  if (!command) return current;
  const dir = path.dirname(command);
  if (!current) return dir;
  const parts = current.split(path.delimiter).filter(Boolean);
  return [dir, ...parts.filter((entry) => path.resolve(entry) !== path.resolve(dir))].join(path.delimiter);
};
