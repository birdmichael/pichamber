/**
 * Address-bar input handling for the browser surface.
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/** `localhost:5173`, `127.0.0.1:3000` — an authority with no scheme. */
const isLoopbackAuthority = (value: string): boolean => {
  const host = value.split('/')[0]?.split('?')[0] ?? '';
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0] ?? '';
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
};

export const BLANK_URL = 'about:blank';

/**
 * True for a local filesystem URL the Browser panel may open.
 *
 * Matches chat markdown (`isLocalFileUrl`): empty host / `localhost` only.
 * WHATWG normalizes `file://localhost/...` to `file:///...` (empty hostname).
 * Remote UNC-style hosts (`file://other-host/...`) stay rejected.
 */
export const isLocalFileUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'file:' && (!parsed.hostname || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
};

/**
 * Normalizes what the user typed into a URL the browser can load.
 *
 * Schemeless input defaults to `https:`, except for loopback authorities:
 * dev servers overwhelmingly speak plain HTTP, and defaulting `localhost:5173`
 * to HTTPS turns the single most common address in this panel into a
 * connection error.
 *
 * Local `file://` / `file:///` / `file://localhost/...` are kept so Desktop can
 * preview HTML on disk. `javascript:`, `data:`, and remote `file://host/...`
 * stay blank.
 */
export const normalizeBrowserUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return BLANK_URL;

  const withScheme = trimmed.includes('://')
    ? trimmed
    : `${isLoopbackAuthority(trimmed) ? 'http' : 'https'}://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    if (parsed.protocol === 'file:' && isLocalFileUrl(parsed.toString())) {
      return parsed.toString();
    }
    return BLANK_URL;
  } catch {
    return BLANK_URL;
  }
};

/** True when a URL points at the machine the page is loaded from. */
export const isLoopbackUrl = (value: string): boolean => {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
};

/** Short label for a tab or header: host plus port, falling back to the raw value. */
export const browserUrlLabel = (value: string): string => {
  if (!value || value === BLANK_URL) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'file:') {
      // Prefer the path so a local HTML preview is recognizable in chrome.
      return decodeURIComponent(parsed.pathname) || value;
    }
    return parsed.host || value;
  } catch {
    return value;
  }
};

/**
 * Chromium network errors that mean "nothing is answering there yet".
 *
 * A dev server is routinely opened the moment its address appears in the
 * terminal, before it accepts connections, so the first load fails as a matter
 * of course. Treating that as a dead end — and making the user press reload —
 * is the single most common way this panel feels broken.
 */
const RETRYABLE_LOAD_ERROR_CODES = new Set([
  -2,   // FAILED (generic; Electron reports this for some early refusals)
  -7,   // TIMED_OUT
  -101, // CONNECTION_RESET
  -102, // CONNECTION_REFUSED
  -104, // CONNECTION_FAILED
  -109, // ADDRESS_UNREACHABLE
  -118, // CONNECTION_TIMED_OUT
  -324, // EMPTY_RESPONSE
]);

/**
 * Whether a failed load is worth retrying. Restricted to loopback: retrying a
 * public site that refused us is just hammering somebody else's server, and a
 * remote dev server is reached through a local tunnel port anyway.
 */
export const isStartingServerFailure = (code: number, url: string): boolean => (
  RETRYABLE_LOAD_ERROR_CODES.has(code) && isLoopbackUrl(url)
);

/**
 * Origins that belong to this Pichamber instance (UI + local API), never to be
 * loaded inside the embedded Browser — that nests the whole app (#726).
 */
export type HostAppBrowserOrigins = {
  pageOrigin?: string | null;
  localOrigin?: string | null;
  apiBaseUrl?: string | null;
};

const originOf = (value: string | null | undefined): string | null => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    try {
      return new URL(raw, 'http://127.0.0.1').origin;
    } catch {
      return null;
    }
  }
};

/** Collect unique http(s) origins that identify the host app for this runtime. */
export const collectHostAppBrowserOrigins = (
  input: HostAppBrowserOrigins = {},
): readonly string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [input.pageOrigin, input.localOrigin, input.apiBaseUrl]) {
    const origin = originOf(candidate);
    if (!origin || seen.has(origin)) continue;
    // Only loopback / same-machine UI nests; a remote API host is a normal site.
    try {
      if (!LOOPBACK_HOSTNAMES.has(new URL(origin).hostname.toLowerCase())) continue;
    } catch {
      continue;
    }
    seen.add(origin);
    out.push(origin);
  }
  return out;
};

/**
 * True when `url` would load this Pichamber instance inside Browser.
 * Compares origin only — path/query differences still nest the shell.
 */
export const isHostAppBrowserUrl = (
  url: string,
  origins: HostAppBrowserOrigins | readonly string[] = {},
): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  // `Array.isArray` does not narrow `readonly string[]` away from the object
  // branch (TS type predicate is `any[]`), so cast the HostAppBrowserOrigins path.
  const list: readonly string[] = Array.isArray(origins)
    ? origins
    : collectHostAppBrowserOrigins(origins as HostAppBrowserOrigins);
  return list.includes(parsed.origin);
};

/** Runtime defaults: page origin, injected local origin, API base. */
export const readHostAppBrowserOrigins = (): readonly string[] => {
  if (typeof window === 'undefined') return [];
  const local = typeof window.__OPENCHAMBER_LOCAL_ORIGIN__ === 'string'
    ? window.__OPENCHAMBER_LOCAL_ORIGIN__
    : '';
  let apiBase = '';
  try {
    // Lazy: avoid a hard import cycle with runtime-switch from this leaf module.
    const injected = (window as typeof window & { __OPENCHAMBER_API_BASE_URL__?: string }).__OPENCHAMBER_API_BASE_URL__;
    if (typeof injected === 'string') apiBase = injected;
  } catch {
    apiBase = '';
  }
  return collectHostAppBrowserOrigins({
    pageOrigin: window.location?.origin ?? '',
    localOrigin: local,
    apiBaseUrl: apiBase,
  });
};

/**
 * Like normalizeBrowserUrl, then blank out the host app UI/API origin so Browser
 * never nests Pichamber inside itself.
 */
export const normalizeBrowsableUrl = (
  value: string,
  origins: HostAppBrowserOrigins | readonly string[] = readHostAppBrowserOrigins(),
): string => {
  const normalized = normalizeBrowserUrl(value);
  if (normalized === BLANK_URL) return BLANK_URL;
  return isHostAppBrowserUrl(normalized, origins) ? BLANK_URL : normalized;
};
