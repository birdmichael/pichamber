import { useSessionUIStore } from '@/sync/session-ui-store';
import { getSyncSessions } from '@/sync/sync-refs';
import { useUIStore } from '@/stores/useUIStore';
import { getRuntimeUrlResolver } from './runtime-url';
import { opencodeClient } from './opencode/client';
import { runtimeFetch } from './runtime-fetch';

declare const __APP_VERSION__: string | undefined;

type ProbeResult = {
  ok: boolean;
  status: number;
  elapsedMs: number;
  summary: string;
};

type OpenChamberHealthSnapshot = {
  kernel?: unknown;
  kernelReady?: unknown;
  piRunning?: unknown;
  openCodePort?: unknown;
  openCodeRunning?: unknown;
  openCodeSecureConnection?: unknown;
  openCodeAuthSource?: unknown;
  isOpenCodeReady?: unknown;
  lastOpenCodeError?: unknown;
  lastOpenCodeLaunchDiagnostics?: unknown;
  opencodeBinaryResolved?: unknown;
  opencodeBinarySource?: unknown;
  opencodeLaunchBinary?: unknown;
  opencodeLaunchArgs?: unknown;
  opencodeLaunchWrapperType?: unknown;
  nodeBinaryResolved?: unknown;
  bunBinaryResolved?: unknown;
  piNodeRuntime?: unknown;
};

type OpenChamberOpencodeResolution = {
  configured?: unknown;
  resolved?: unknown;
  resolvedDir?: unknown;
  source?: unknown;
  detectedNow?: unknown;
  detectedSourceNow?: unknown;
  launchBinary?: unknown;
  launchArgs?: unknown;
  launchWrapperType?: unknown;
  node?: unknown;
  bun?: unknown;
};

const getCurrentDirectory = (): string => {
  const state = useSessionUIStore.getState();
  const currentSessionId = state.currentSessionId;
  if (!currentSessionId) return '';
  const sessions = getSyncSessions();
  const session = sessions.find((s) => s.id === currentSessionId);
  return typeof session?.directory === 'string' ? session.directory : '';
};

const safeFetch = async (input: string, timeoutMs = 6000): Promise<ProbeResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const resp = await runtimeFetch(input, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    const elapsedMs = Date.now() - startedAt;
    const contentType = resp.headers.get('content-type') || '';
    const lower = contentType.toLowerCase();
    const isJson = lower.includes('json') && !lower.includes('text/html');

    let summary = '';
    if (isJson) {
      const json = await resp.json().catch(() => null);
      if (Array.isArray(json)) {
        summary = `json[array] len=${json.length}`;
      } else if (json && typeof json === 'object') {
        const keys = Object.keys(json).slice(0, 8);
        summary = `json[object] keys=${keys.join(',')}${Object.keys(json).length > keys.length ? ',…' : ''}`;
      } else {
        summary = `json[${typeof json}]`;
      }
    } else {
      summary = contentType ? `content-type=${contentType}` : 'no content-type';
    }

    return { ok: resp.ok && isJson, status: resp.status, elapsedMs, summary };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const isAbort =
      controller.signal.aborted ||
      (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted')));
    const message = isAbort
      ? `timeout after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    return { ok: false, status: 0, elapsedMs, summary: `error=${message}` };
  } finally {
    clearTimeout(timeout);
  }
};

const formatIso = (timestamp: number | null | undefined): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return '(n/a)';
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return '(invalid)';
  }
};

const normalizePort = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const formatUnknown = (value: unknown, fallback = '(n/a)'): string => {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return fallback;
};

const formatLaunchRuntime = (wrapperType: string, node: string, bun: string): string => {
  if (wrapperType === 'node-shebang' || wrapperType === 'node-launcher') {
    return node ? `node (${node})` : 'node';
  }
  if (wrapperType === 'bun-shebang') {
    return bun ? `bun (${bun})` : 'bun';
  }
  if (wrapperType) {
    return wrapperType;
  }
  return 'direct executable';
};

const formatPiNodeRuntimeLines = (runtime: Record<string, unknown> | null): string[] => {
  const lines = ['Pi kernel resolution:'];
  if (!runtime) {
    lines.push('- node: (n/a)');
    return lines;
  }
  const command = formatUnknown(runtime.command);
  const source = formatUnknown(runtime.source);
  lines.push(`- node: ${command} (source=${source})`);
  const code = typeof runtime.code === 'string' ? runtime.code.trim() : '';
  const message = typeof runtime.message === 'string' ? runtime.message.trim() : '';
  const recovery = typeof runtime.recovery === 'string' ? runtime.recovery.trim() : '';
  if (runtime.ok === false || code || message) {
    lines.push(`- error: ${[code, message].filter(Boolean).join(' ') || '(n/a)'}`);
    if (recovery) lines.push(`- recovery: ${recovery}`);
  }
  const hello = isRecord(runtime.hello) ? runtime.hello : null;
  const sdk = hello && isRecord(hello.sdk) ? hello.sdk : null;
  if (sdk) {
    const pkg = typeof sdk.package === 'string' ? sdk.package.trim() : '';
    const ver = typeof sdk.version === 'string' ? sdk.version.trim() : '';
    if (pkg || ver) lines.push(`- sdk: ${[pkg, ver].filter(Boolean).join(' ')}`);
  }
  if (typeof runtime.childScript === 'string' && runtime.childScript.trim()) {
    lines.push(`- child-script: ${runtime.childScript.trim()}`);
  }
  const pid = runtime.pid ?? hello?.pid;
  if (typeof pid === 'number' && Number.isFinite(pid) && pid > 0) {
    lines.push(`- pid: ${pid}`);
  }
  return lines;
};

/** Diagnostic dump of how this process boots. Pi never lists leftover OpenCode PATH. */
export const formatKernelResolutionLines = ({
  kernel,
  health,
  opencodeResolution,
  isMac,
}: {
  kernel: string;
  health: OpenChamberHealthSnapshot | null;
  opencodeResolution: OpenChamberOpencodeResolution | null;
  isMac: boolean;
}): string[] => {
  if (kernel === 'opencode') {
    if (!isMac) return [];

  const lines: string[] = ['OpenCode resolution:'];
  const launchDiagnostics = isRecord(health?.lastOpenCodeLaunchDiagnostics)
    ? health.lastOpenCodeLaunchDiagnostics
    : null;
  const actualLaunchArgs = launchDiagnostics && Array.isArray(launchDiagnostics.args)
    ? launchDiagnostics.args.filter((value): value is string => typeof value === 'string')
    : [];
  const configured =
    opencodeResolution && typeof opencodeResolution.configured === 'string'
      ? opencodeResolution.configured
      : null;
  const resolved =
    opencodeResolution && typeof opencodeResolution.resolved === 'string'
      ? opencodeResolution.resolved
      : (health && typeof health.opencodeBinaryResolved === 'string' ? health.opencodeBinaryResolved : '');
  const resolvedDir =
    opencodeResolution && typeof opencodeResolution.resolvedDir === 'string'
      ? opencodeResolution.resolvedDir
      : '';
  const source =
    opencodeResolution && typeof opencodeResolution.source === 'string'
      ? opencodeResolution.source
      : (health && typeof health.opencodeBinarySource === 'string' ? health.opencodeBinarySource : '');
  const configuredLaunchBinary =
    opencodeResolution && typeof opencodeResolution.launchBinary === 'string'
      ? opencodeResolution.launchBinary
      : (health && typeof health.opencodeLaunchBinary === 'string' ? health.opencodeLaunchBinary : '');
  const configuredLaunchWrapperType =
    opencodeResolution && typeof opencodeResolution.launchWrapperType === 'string'
      ? opencodeResolution.launchWrapperType
      : (health && typeof health.opencodeLaunchWrapperType === 'string' ? health.opencodeLaunchWrapperType : '');
  const configuredLaunchArgs =
    opencodeResolution && Array.isArray(opencodeResolution.launchArgs)
      ? opencodeResolution.launchArgs.filter((value): value is string => typeof value === 'string')
      : (health && Array.isArray(health.opencodeLaunchArgs)
        ? health.opencodeLaunchArgs.filter((value): value is string => typeof value === 'string')
        : []);
  const node =
    opencodeResolution && typeof opencodeResolution.node === 'string'
      ? opencodeResolution.node
      : (health && typeof health.nodeBinaryResolved === 'string' ? health.nodeBinaryResolved : '');
  const bun =
    opencodeResolution && typeof opencodeResolution.bun === 'string'
      ? opencodeResolution.bun
      : (health && typeof health.bunBinaryResolved === 'string' ? health.bunBinaryResolved : '');
  const detectedNow =
    opencodeResolution && typeof opencodeResolution.detectedNow === 'string'
      ? opencodeResolution.detectedNow
      : '';
  const detectedSourceNow =
    opencodeResolution && typeof opencodeResolution.detectedSourceNow === 'string'
      ? opencodeResolution.detectedSourceNow
      : '';

  if (configured !== null) {
    lines.push(`- configured: ${configured.trim().length === 0 ? '(cleared)' : configured}`);
  }
  if (resolved) {
    const dir = resolvedDir || (resolved.includes('/') ? resolved.split('/').slice(0, -1).join('/') || '/' : '');
    lines.push(`- opencode: ${resolved}${dir ? ` (dir=${dir})` : ''}`);
  } else {
    lines.push('- opencode: (n/a)');
  }
  lines.push(`- source: ${source || '(n/a)'}`);
  if (detectedNow) {
    lines.push(`- detected-now: ${detectedNow}`);
    lines.push(`- detected-source: ${detectedSourceNow || '(n/a)'}`);
  }
  if (launchDiagnostics) {
    lines.push(`- launched-at: ${formatUnknown(launchDiagnostics.launchedAt)}`);
    lines.push(`- launch: ${formatUnknown(launchDiagnostics.binary)} ${actualLaunchArgs.join(' ')}`.trim());
    lines.push(`- cwd: ${formatUnknown(launchDiagnostics.cwd)}`);
    lines.push(`- wrapper: ${formatUnknown(launchDiagnostics.wrapperType)}`);
    lines.push(`- runtime: ${formatLaunchRuntime(formatUnknown(launchDiagnostics.wrapperType, ''), node, bun)}`);
    lines.push(`- PATH entries: ${formatUnknown(launchDiagnostics.pathEntryCount, '(unknown)')}`);
    lines.push(`- shell env: ${formatUnknown(launchDiagnostics.hasShellEnv, '(unknown)')} (${formatUnknown(launchDiagnostics.shellEnvKeysCount, '?')} keys)`);
  } else {
    lines.push(`- launch-binary: ${configuredLaunchBinary || '(n/a)'}`);
    lines.push(`- launch-wrapper: ${configuredLaunchWrapperType || '(n/a)'}`);
    lines.push(`- launch-args: ${configuredLaunchArgs.length ? configuredLaunchArgs.join(' ') : '(none)'}`);
    lines.push(`- runtime: ${formatLaunchRuntime(configuredLaunchWrapperType || '', node, bun)}`);
  }
    return lines;
  }
  return formatPiNodeRuntimeLines(isRecord(health?.piNodeRuntime) ? health.piNodeRuntime : null);
};

const buildOpenCodeStatusReport = async (): Promise<string> => {
  const now = new Date();
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '(unknown)';
  const platform = typeof navigator !== 'undefined' ? navigator.userAgent : '(no navigator)';
  const directory = getCurrentDirectory();
  const eventStreamStatus = useUIStore.getState().eventStreamStatus;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const urls = getRuntimeUrlResolver();
  const healthUrl = urls.health();
  const apiBase = urls.api('/api/');

  const openChamberHealth: OpenChamberHealthSnapshot | null = await (async () => {
    if (!healthUrl) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await runtimeFetch(healthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!resp.ok) return null;
      const json = (await resp.json().catch(() => null)) as unknown;
      if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
      return json as OpenChamberHealthSnapshot;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();

  const openChamberOpencodeResolutionResult: {
    data: OpenChamberOpencodeResolution | null;
    status: number | null;
    error: string | null;
  } = await (async () => {
    if (!apiBase) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const resp = await runtimeFetch(urls.api('/api/config/opencode-resolution'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const contentType = resp.headers.get('content-type') || '(none)';
      if (!resp.ok) {
        return { data: null, status: resp.status, error: `http ${resp.status} content-type=${contentType}` };
      }
      const raw = await resp.text();
      let json: unknown = null;
      try {
        json = JSON.parse(raw);
      } catch {
        const snippet = raw.replace(/\s+/g, ' ').slice(0, 120);
        return {
          data: null,
          status: resp.status,
          error: `invalid json content-type=${contentType} body=${snippet || '(empty)'}`,
        };
      }
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return { data: null, status: resp.status, error: `invalid json-shape content-type=${contentType}` };
      }
      return { data: json as OpenChamberOpencodeResolution, status: resp.status, error: null };
    } catch (error) {
      return {
        data: null,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  })() || { data: null, status: null, error: null };

  const buildProbeUrl = (pathname: string, includeDirectory = true): string | null => {
    if (!apiBase) return null;
    const url = new URL(pathname.replace(/^\/+/, ''), apiBase);
    if (includeDirectory && directory) {
      url.searchParams.set('directory', directory);
    }
    return url.toString();
  };

  const probeTargets: Array<{ label: string; path: string; includeDirectory?: boolean; timeoutMs?: number }> = [
    { label: 'health', path: '/health', includeDirectory: false },
    { label: 'config', path: '/config', includeDirectory: true },
    { label: 'providers', path: '/config/providers', includeDirectory: true },
    { label: 'agents', path: '/agent', includeDirectory: true, timeoutMs: 12000 },
    { label: 'commands', path: '/command', includeDirectory: true, timeoutMs: 10000 },
    { label: 'project', path: '/project/current', includeDirectory: true },
    { label: 'path', path: '/path', includeDirectory: true },
    { label: 'sessions', path: '/session', includeDirectory: true, timeoutMs: 12000 },
    { label: 'sessionStatus', path: '/session/status', includeDirectory: true },
  ];

  const probes = apiBase
    ? await Promise.all(
        probeTargets.map(async (entry) => {
          const url = buildProbeUrl(entry.path, entry.includeDirectory !== false);
          if (!url) return { label: entry.label, url: '(none)', result: null as ProbeResult | null };
          const result = await safeFetch(url, typeof entry.timeoutMs === 'number' ? entry.timeoutMs : undefined);
          return { label: entry.label, url, result };
        })
      )
    : [];

  const lines: string[] = [];
  lines.push(`Time: ${now.toISOString()}`);
  lines.push(`Pichamber version: ${appVersion}`);
  lines.push(`Runtime: ${origin || '(unknown)'} (api=${apiBase || '(unknown)'})`);
  lines.push(`Pi kernel base: ${opencodeClient.getBaseUrl()}`);
  lines.push(`Event stream: ${eventStreamStatus}`);
  lines.push(`Directory: ${directory || '(none)'}`);
  lines.push(`Platform: ${platform}`);

  const runtimeOpenCodePort = normalizePort(openChamberHealth?.openCodePort);
  if (typeof openChamberHealth?.kernel === 'string' && openChamberHealth.kernel.trim()) {
    lines.push(`Kernel: ${openChamberHealth.kernel}`);
  }
  if (typeof openChamberHealth?.piRunning === 'boolean') {
    lines.push(`Pi runtime running: ${openChamberHealth.piRunning ? 'yes' : 'no'}`);
  } else if (typeof openChamberHealth?.kernelReady === 'boolean') {
    lines.push(`Kernel ready: ${openChamberHealth.kernelReady ? 'yes' : 'no'}`);
  }
  lines.push(`OpenCode port: ${runtimeOpenCodePort ?? '(none)'}`);
  if (typeof openChamberHealth?.openCodeRunning === 'boolean') {
    lines.push(`OpenCode running: ${openChamberHealth.openCodeRunning ? 'yes' : 'no'}`);
  }
  if (typeof openChamberHealth?.openCodeSecureConnection === 'boolean') {
    lines.push(`Secure Pi connection: ${openChamberHealth.openCodeSecureConnection ? 'true' : 'false'}`);
  }
  if (typeof openChamberHealth?.openCodeAuthSource === 'string' && openChamberHealth.openCodeAuthSource.trim()) {
    lines.push(`Pi auth source: ${openChamberHealth.openCodeAuthSource}`);
  }

  if (typeof window !== 'undefined') {
    const injected = (window as unknown as { __OPENCHAMBER_MACOS_MAJOR__?: unknown }).__OPENCHAMBER_MACOS_MAJOR__;
    if (typeof injected === 'number' && Number.isFinite(injected) && injected > 0) {
      lines.push(`macOS major: ${injected}`);
    }
  }

  const kernel = typeof openChamberHealth?.kernel === 'string' ? openChamberHealth.kernel.trim() : '';
  const isLikelyMac = /Mac OS X|Macintosh/.test(platform);
  const resolutionLines = formatKernelResolutionLines({
    kernel,
    health: openChamberHealth,
    opencodeResolution: openChamberOpencodeResolutionResult.data,
    isMac: isLikelyMac,
  });
  if (resolutionLines.length) {
    lines.push('');
    lines.push(...resolutionLines);
    if (
      kernel !== 'pi'
      && !openChamberOpencodeResolutionResult.data
      && openChamberOpencodeResolutionResult.error
    ) {
      lines.push(`- resolution-endpoint: ${openChamberOpencodeResolutionResult.error}`);
    }
  }

  lines.push('');
  if (probes.length) {
    lines.push('Pi API probes:');
    for (const probe of probes) {
      if (!probe.result) {
        lines.push(`- ${probe.label}: (no url)`);
        continue;
      }
      const { ok, status, elapsedMs, summary } = probe.result;
      const suffix = ok ? '' : ` url=${probe.url}`;
      lines.push(`- ${probe.label}: ${ok ? 'ok' : 'fail'} status=${status} time=${elapsedMs}ms ${summary}${suffix}`);
    }
  } else {
    lines.push('Pi API probes: (skipped)');
  }

  lines.push('');
  lines.push(`Generated: ${formatIso(Date.now())}`);
  return lines.join('\n');
};

export const showOpenCodeStatus = async (): Promise<void> => {
  const text = await buildOpenCodeStatusReport();
  const ui = useUIStore.getState();
  ui.setOpenCodeStatusText(text);
  ui.setOpenCodeStatusDialogOpen(true);
};
