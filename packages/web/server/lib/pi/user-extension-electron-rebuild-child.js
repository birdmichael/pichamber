import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const listFiles = (dir) => {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

const findPrebuildFile = (packageDir, { platform, arch, modules }) => {
  const prebuilds = path.join(packageDir, 'prebuilds');
  if (!existsSync(prebuilds)) return '';
  const folder = path.join(prebuilds, `${platform}-${arch}`);
  const names = [
    `electron.abi${modules}.node`,
    'electron.napi.node',
    'node.napi.node',
  ];
  for (const name of names) {
    const file = path.join(folder, name);
    if (existsSync(file)) return file;
  }
  for (const entry of listFiles(folder)) {
    if (!entry.endsWith('.node')) continue;
    const lower = entry.toLowerCase();
    if (lower.includes('electron') || lower.includes('napi')) {
      return path.join(folder, entry);
    }
  }
  return '';
};

const copyPrebuildToRelease = (packageDir, prebuildPath) => {
  const destDir = path.join(packageDir, 'build', 'Release');
  mkdirSync(destDir, { recursive: true });
  const destName = path.join(destDir, 'addon.node');
  copyFileSync(prebuildPath, destName);
  return destName;
};

const commandExists = (command) => {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, [command], { encoding: 'utf8' });
  return result.status === 0;
};

const rebuildWithNodeGyp = ({ packageDir, electronVersion, arch }) => {
  if (!commandExists('node-gyp')) {
    return { ok: false, error: 'node-gyp is not available' };
  }
  const args = ['rebuild'];
  const env = {
    ...process.env,
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
    npm_config_arch: arch,
    npm_config_disturl: 'https://electronjs.org/headers',
    npm_config_build_from_source: 'true',
  };
  if (asText(electronVersion)) {
    args.push(`--target=${electronVersion}`);
  }
  if (asText(arch)) {
    args.push(`--arch=${arch}`);
  }
  args.push('--dist-url=https://electronjs.org/headers');
  const result = spawnSync('node-gyp', args, {
    cwd: packageDir,
    env,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return { ok: true, method: 'node-gyp' };
  }
  const error = asText(result.stderr) || asText(result.stdout) || `node-gyp exited ${result.status}`;
  return { ok: false, error };
};

export const rebuildIsolatedNativePackage = (options = {}) => {
  const packageDir = asText(options.packageDir);
  if (!packageDir || !existsSync(packageDir) || !statSync(packageDir).isDirectory()) {
    return { ok: false, error: 'isolated package directory is missing' };
  }
  const platform = asText(options.platform) || process.platform;
  const arch = asText(options.arch) || process.arch;
  const modules = options.modules == null ? '' : String(options.modules);
  const electronVersion = asText(options.electronVersion);
  const prebuild = findPrebuildFile(packageDir, { platform, arch, modules });
  if (prebuild) {
    copyPrebuildToRelease(packageDir, prebuild);
    return { ok: true, method: 'prebuild' };
  }
  return rebuildWithNodeGyp({ packageDir, electronVersion, arch });
};

const reply = (payload) => {
  if (typeof process.send === 'function') {
    process.send(payload);
    return;
  }
  if (payload.ok) process.exit(0);
  process.stderr.write(`${payload.error || 'rebuild failed'}\n`);
  process.exit(1);
};

const isMain = Boolean(process.argv[1])
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const run = (payload) => {
    try {
      reply(rebuildIsolatedNativePackage(payload || {}));
    } catch (error) {
      reply({ ok: false, error: error?.message || String(error) });
    }
  };
  if (typeof process.send === 'function') {
    process.once('message', run);
  } else {
    run({
      packageDir: process.env.PICHAMBER_ELECTRON_REBUILD_DIR,
      electronVersion: process.env.PICHAMBER_ELECTRON_VERSION,
      modules: process.env.PICHAMBER_ELECTRON_MODULES,
      platform: process.env.PICHAMBER_ELECTRON_PLATFORM,
      arch: process.env.PICHAMBER_ELECTRON_ARCH,
    });
  }
}
