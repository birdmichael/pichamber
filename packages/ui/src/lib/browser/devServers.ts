/**
 * Client for dev-server discovery.
 *
 * The result is a tagged union rather than an array, because "no dev server is
 * running" and "we could not look" lead to different UI and must not collapse
 * into the same empty list.
 */
import { runtimeFetch } from '@/lib/runtime-fetch';
import { isHostAppBrowserUrl, readHostAppBrowserOrigins } from './url';

export type DiscoveredDevServer = {
  readonly port: number;
  readonly url: string;
  readonly command: string;
};

export type DevServerDiscovery =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly servers: ReadonlyArray<DiscoveredDevServer> }
  | { readonly kind: 'unavailable' };

const isDiscoveredServer = (value: unknown): value is DiscoveredDevServer => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.port === 'number'
    && Number.isFinite(record.port)
    && typeof record.url === 'string'
    && record.url.length > 0
    && typeof record.command === 'string';
};

export const fetchDevServers = async (signal?: AbortSignal): Promise<DevServerDiscovery> => {
  try {
    const response = await runtimeFetch('/api/dev-servers', { signal });
    if (!response.ok) return { kind: 'unavailable' };

    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return { kind: 'unavailable' };

    const servers = (body as { servers?: unknown }).servers;
    if (!Array.isArray(servers)) return { kind: 'unavailable' };

    return { kind: 'ready', servers: servers.filter(isDiscoveredServer) };
  } catch {
    return { kind: 'unavailable' };
  }
};

/**
 * Asks the server for the HTTP status a loopback URL currently returns.
 *
 * A dev server fronted by a gateway answers requests before the app behind it
 * is up, returning a 5xx page. That is a successful load as far as the browser
 * is concerned, so it produces no navigation failure — the status is the only
 * honest signal, short of reading the page and guessing from its contents.
 *
 * Returns null when the status could not be established.
 */
export const probeLoopbackStatus = async (url: string): Promise<number | null> => {
  try {
    const response = await runtimeFetch('/api/system/probe-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return null;
    const status = (body as { status?: unknown }).status;
    return typeof status === 'number' && Number.isFinite(status) ? status : null;
  } catch {
    return null;
  }
};

export type DevServerCandidate = {
  readonly url: string;
  readonly port: number;
  /** Present when a server announced this address itself. */
  readonly announced: boolean;
};

const portOf = (url: string): number | null => {
  try {
    const parsed = new URL(url);
    const port = Number.parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
};

/**
 * Combines what servers announced with what is actually listening.
 *
 * Announcements are the product signal: project actions and terminal
 * announce-protocol lines name the URLs a user just started, including base
 * paths a socket scan cannot see. A raw listener scan also sees every other
 * loopback service on the machine; offering those as "Running dev servers" is
 * noise.
 *
 * Discovery therefore only validates announcements (drop mangled / dead ports).
 * When discovery is unavailable the announcements stand on their own — offering
 * something unverified beats offering nothing. With no announcements, the list
 * is empty even if many ports are listening.
 */
export const mergeDevServerCandidates = ({
  announced,
  discovered,
  hostOrigins = readHostAppBrowserOrigins(),
}: {
  announced: ReadonlyArray<string>;
  discovered: ReadonlyArray<DiscoveredDevServer> | null;
  /** Origins of this Pichamber instance — never offered as Browser targets (#726). */
  hostOrigins?: readonly string[];
}): DevServerCandidate[] => {
  const announcedByPort = new Map<number, string>();
  for (const url of announced) {
    if (isHostAppBrowserUrl(url, hostOrigins)) continue;
    const port = portOf(url);
    if (port !== null && !announcedByPort.has(port)) announcedByPort.set(port, url);
  }

  // Announcements are the only honest "dev server" signal. A raw port scan
  // sees every loopback listener (agents, databases' admin UIs, random local
  // tools) and labeling them all "Running dev servers" is noise. Discovery
  // still matters: it confirms an announced address is actually listening and
  // drops mangled announcement ports that point nowhere.
  if (announcedByPort.size === 0) {
    return [];
  }

  if (!discovered) {
    return [...announcedByPort.entries()]
      .map(([port, url]) => ({ url, port, announced: true }))
      .sort((left, right) => left.port - right.port);
  }

  const discoveredPorts = new Set(discovered.map((server) => server.port));
  return [...announcedByPort.entries()]
    .filter(([port]) => discoveredPorts.has(port))
    .map(([port, url]) => ({ url, port, announced: true }))
    .sort((left, right) => left.port - right.port);
};
