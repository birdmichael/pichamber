import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHILD_PATH = fileURLToPath(new URL('./user-extension-electron-rebuild-child.js', import.meta.url));

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

export const rebuildIsolatedNativePackageInChild = ({
  packageDir,
  versions = process.versions,
  platform = process.platform,
  arch = process.arch,
  spawnImpl,
  timeoutMs = 120_000,
} = {}) => {
  const dir = asText(packageDir);
  if (!dir) {
    return Promise.resolve({ ok: false, error: 'isolated package directory is missing' });
  }
  const payload = {
    packageDir: dir,
    electronVersion: asText(versions?.electron),
    modules: versions?.modules == null ? '' : String(versions.modules),
    platform,
    arch,
  };
  const start = spawnImpl || fork;
  return new Promise((resolve) => {
    let settled = false;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        child?.kill?.();
      } catch {
      }
      resolve(result && typeof result === 'object' ? result : { ok: false, error: 'rebuild failed' });
    };
    try {
      child = start(CHILD_PATH, [], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        serialization: 'json',
      });
    } catch (error) {
      finish({ ok: false, error: error?.message || String(error) });
      return;
    }
    if (!child || typeof child.on !== 'function') {
      finish({ ok: false, error: 'rebuild child process could not start' });
      return;
    }
    const timer = setTimeout(() => {
      finish({ ok: false, error: 'rebuild timed out' });
    }, timeoutMs);
    child.on('message', (message) => {
      clearTimeout(timer);
      finish(message);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, error: error?.message || String(error) });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!settled) {
        finish(code === 0
          ? { ok: true }
          : { ok: false, error: `rebuild exited ${code}` });
      }
    });
    if (typeof child.send === 'function') {
      child.send(payload);
    }
  });
};
