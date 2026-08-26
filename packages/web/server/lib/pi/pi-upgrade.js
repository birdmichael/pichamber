import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { PI_SDK_PACKAGE, readInstalledPiSdkVersion } from './pi-upgrade-status.js';

export const PI_UPDATE_IN_PROGRESS_CODE = 'PI_UPGRADE_IN_PROGRESS';
const PI_UPGRADE_UNSUPPORTED_CODE = 'PI_UPGRADE_UNSUPPORTED';
const PI_UPDATE_CLI_UNAVAILABLE_CODE = 'PI_UPGRADE_CLI_UNAVAILABLE';

export const createPiUpgradeUnsupportedError = () => {
  const error = new Error(
    'The bundled Pi SDK cannot be upgraded in-app. Install a newer Pichamber to get a newer kernel.',
  );
  error.status = 403;
  error.code = PI_UPGRADE_UNSUPPORTED_CODE;
  return error;
};
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const defaultRequire = createRequire(import.meta.url);

const basenameOf = (filePath) => path.basename(filePath || '').toLowerCase();

const resolveInProcessPiCli = ({
  requireImpl = defaultRequire,
  readFileSync = fs.readFileSync,
  existsSync = fs.existsSync,
} = {}) => {
  try {
    const pkgPath = requireImpl.resolve(`${PI_SDK_PACKAGE}/package.json`);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const binRel = typeof pkg?.bin === 'string'
      ? pkg.bin
      : (pkg?.bin && typeof pkg.bin.pi === 'string' ? pkg.bin.pi : '');
    if (!binRel.trim()) return null;
    const script = path.resolve(path.dirname(pkgPath), binRel);
    if (!existsSync(script)) return null;
    return { script, packageDir: path.dirname(pkgPath) };
  } catch {
    return null;
  }
};

export const resolveNodeRuntimeForPiCli = ({
  execPath = process.execPath,
  platform = process.platform,
  versions = process.versions,
} = {}) => {
  const base = basenameOf(execPath);
  if (
    base === 'node'
    || base === 'node.exe'
    || base === 'bun'
    || base === 'bun.exe'
  ) {
    return { command: execPath, extraEnv: {} };
  }
  // Packaged Desktop is `Pichamber`, not `electron`. Prefer the running
  // binary with ELECTRON_RUN_AS_NODE over a PATH `node`.
  if (
    versions?.electron
    || base.includes('electron')
    || base.includes('pichamber')
    || execPath.toLowerCase().includes('.app/contents/macos/')
  ) {
    return { command: execPath, extraEnv: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return {
    command: platform === 'win32' ? 'node.exe' : 'node',
    extraEnv: {},
  };
};

export const resolvePiUpdateInvocation = ({
  agentDir,
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  resolveCli = resolveInProcessPiCli,
} = {}) => {
  const cli = resolveCli();
  if (!cli?.script) return null;
  const runtime = resolveNodeRuntimeForPiCli({ execPath, platform });
  const nextEnv = {
    ...env,
    ...runtime.extraEnv,
  };
  const resolvedAgentDir = typeof agentDir === 'string' ? agentDir.trim() : '';
  if (resolvedAgentDir) {
    nextEnv.PI_CODING_AGENT_DIR = resolvedAgentDir;
  }
  return {
    command: runtime.command,
    args: [cli.script, 'update'],
    env: nextEnv,
    script: cli.script,
  };
};

const collectOutput = (stream, chunks) => {
  if (!stream) return;
  stream.on('data', (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
};

const trimOutput = (chunks, limit = 4000) => {
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length <= limit) return text;
  return text.slice(-limit);
};

export const runPiSelfUpdate = ({
  agentDir,
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  resolveInvocation = resolvePiUpdateInvocation,
} = {}) => new Promise((resolve, reject) => {
  const invocation = resolveInvocation({ agentDir, env, execPath, platform });
  if (!invocation) {
    const error = new Error('The in-process Pi CLI is not available to run `pi update`.');
    error.status = 503;
    error.code = PI_UPDATE_CLI_UNAVAILABLE_CODE;
    reject(error);
    return;
  }

  const child = spawnImpl(invocation.command, invocation.args, {
    env: invocation.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  collectOutput(child.stdout, stdoutChunks);
  collectOutput(child.stderr, stderrChunks);

  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    try {
      child.kill('SIGTERM');
    } catch {
      // The process may already have exited.
    }
    const error = new Error('`pi update` timed out.');
    error.status = 504;
    reject(error);
  }, timeoutMs);

  child.on('error', (cause) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const error = new Error(cause?.message || 'Failed to start `pi update`.');
    error.status = 500;
    error.cause = cause;
    reject(error);
  });

  child.on('close', (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const stdout = trimOutput(stdoutChunks);
    const stderr = trimOutput(stderrChunks);
    if (code === 0) {
      resolve({
        ok: true,
        command: 'pi update',
        currentVersion: readInstalledPiSdkVersion(),
        stdout,
        stderr,
      });
      return;
    }
    const detail = stderr || stdout || (signal ? `terminated by ${signal}` : `exited with code ${code ?? 'unknown'}`);
    const error = new Error(`\`pi update\` failed: ${detail}`);
    error.status = 500;
    error.stdout = stdout;
    error.stderr = stderr;
    reject(error);
  });
});
