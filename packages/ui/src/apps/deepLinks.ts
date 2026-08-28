/**
 * Pichamber deep-link vocabulary — the single source of truth for the `pichamber://`
 * URL scheme used across every native entry point: notification taps, home-screen / lock-
 * screen widgets, and (later) Live Activities. Anything that wants to drive navigation
 * builds a URL with {@link buildDeepLink} and anything that receives one parses it with
 * {@link parseDeepLink} into a typed {@link DeepLinkIntent}; the navigation layer
 * (deepLinkNavigation) is the only place that knows how to *apply* an intent.
 *
 * Keep this file pure (no React, no stores, no Capacitor) so it can be imported from any
 * context — including, eventually, a tiny encoder shared with the native widget/extension.
 *
 * New links emit `pichamber://`. Parsers also accept leftover `openchamber://` (any case)
 * so already-printed QR codes and old widget URLs still redeem.
 */

const DEEP_LINK_SCHEME = 'pichamber';
const LEGACY_DEEP_LINK_SCHEME = 'openchamber';

const isDeepLinkProtocol = (protocol: string): boolean => {
  const normalized = protocol.toLowerCase();
  return normalized === `${DEEP_LINK_SCHEME}:` || normalized === `${LEGACY_DEEP_LINK_SCHEME}:`;
};

export type SessionsFilter = 'all' | 'attention' | 'recent';
export type ViewTarget = 'files' | 'mcp' | 'instances' | 'update';

/**
 * Every navigable destination the app exposes to the outside world. New widget/notification
 * ideas should add a variant here first, then teach deepLinkNavigation how to apply it —
 * that keeps the "blocks" composable without leaking ad-hoc URL parsing into features.
 */
export type DeepLinkSessionAction = 'confirm' | 'cancel';

export type DeepLinkIntent =
  | {
    type: 'session';
    sessionId: string;
    directory?: string;
    promptId?: string;
    action?: DeepLinkSessionAction;
  }
  | { type: 'new-session'; directory?: string; projectId?: string; agent?: string; model?: string }
  | { type: 'sessions'; filter?: SessionsFilter }
  | { type: 'status' }
  | { type: 'settings'; section?: string }
  | { type: 'changes'; path?: string; staged?: boolean }
  | { type: 'view'; target: ViewTarget };

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

const segmentsOf = (url: URL): string[] => {
  // Custom-scheme URLs put the first route token in `host` (pichamber://session/<id>),
  // but be tolerant of authority-less forms (pichamber:/session/<id>) where it lands in
  // the pathname instead.
  const pathSegments = trimSlashes(url.pathname).split('/').filter(Boolean);
  if (url.host) {
    return [url.host, ...pathSegments];
  }
  return pathSegments;
};

/**
 * Parse a raw `pichamber://…` or leftover `openchamber://…` string into a typed intent,
 * or `null` if it isn't a recognised Pichamber deep link. Tolerant by design: unknown
 * routes return `null` rather than throwing, so callers can fall back without a try/catch.
 */
export function parseDeepLink(raw: string | null | undefined): DeepLinkIntent | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (!isDeepLinkProtocol(url.protocol)) {
    return null;
  }

  const segments = segmentsOf(url);
  const route = (segments[0] ?? '').toLowerCase();
  const rest = segments.slice(1);
  const query = url.searchParams;

  switch (route) {
    case 'session': {
      const sessionId = rest[0] || query.get('id') || '';
      if (!sessionId) {
        return null;
      }
      const directory = query.get('dir') ?? undefined;
      const promptId = query.get('prompt') ?? undefined;
      return {
        type: 'session',
        sessionId,
        ...(directory ? { directory } : {}),
        ...(promptId ? { promptId } : {}),
      };
    }

    case 'new':
    case 'new-session':
      return {
        type: 'new-session',
        directory: query.get('dir') ?? undefined,
        projectId: query.get('project') ?? undefined,
        agent: query.get('agent') ?? undefined,
        model: query.get('model') ?? undefined,
      };

    case 'sessions': {
      const filter = query.get('filter');
      return {
        type: 'sessions',
        filter: filter === 'attention' || filter === 'recent' || filter === 'all' ? filter : undefined,
      };
    }

    case 'status':
      return { type: 'status' };

    case 'settings':
      return { type: 'settings', section: rest[0] || query.get('section') || undefined };

    case 'changes':
      return {
        type: 'changes',
        path: rest.join('/') || query.get('path') || undefined,
        staged: query.get('staged') === 'true',
      };

    case 'view': {
      const target = (rest[0] || '').toLowerCase();
      // `changes` has its own richer intent (diff path); route the bare view token to it.
      if (target === 'changes') {
        return { type: 'changes' };
      }
      if (target === 'files' || target === 'mcp' || target === 'instances' || target === 'update') {
        return { type: 'view', target };
      }
      return null;
    }

    default:
      return null;
  }
}

const withQuery = (path: string, params: Record<string, string | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};

/** Build a `pichamber://` URL for widgets, notification taps, and native actions. */
export function buildDeepLink(intent: DeepLinkIntent): string {
  switch (intent.type) {
    case 'session':
      return withQuery(`pichamber://session/${intent.sessionId}`, {
        dir: intent.directory,
        prompt: intent.promptId,
      });
    case 'new-session':
      return withQuery('pichamber://new', {
        dir: intent.directory,
        project: intent.projectId,
        agent: intent.agent,
        model: intent.model,
      });
    case 'sessions':
      return withQuery('pichamber://sessions', { filter: intent.filter });
    case 'status':
      return 'pichamber://status';
    case 'settings':
      return intent.section ? `pichamber://settings/${intent.section}` : 'pichamber://settings';
    case 'changes':
      return withQuery(intent.path ? `pichamber://changes/${intent.path}` : 'pichamber://changes', {
        staged: intent.staged ? 'true' : undefined,
      });
    case 'view':
      return `pichamber://view/${intent.target}`;
  }
}

type PushActionPerformed = {
  actionId?: string;
  notification?: { data?: Record<string, unknown> };
};

const asNonEmptyString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.length > 0 ? value : undefined
);

/** Turn a Capacitor push tap/action into a deep-link intent. */
export function intentFromPushAction(action: PushActionPerformed | null | undefined): DeepLinkIntent | null {
  const data = action?.notification?.data;
  const nativeUrl = asNonEmptyString(data?.deeplink) ?? asNonEmptyString(data?.url);
  const fromUrl = nativeUrl ? parseDeepLink(nativeUrl) : null;
  const sessionId = fromUrl?.type === 'session'
    ? fromUrl.sessionId
    : asNonEmptyString(data?.sessionId);
  if (!sessionId) {
    return fromUrl;
  }
  const promptId = (fromUrl?.type === 'session' ? fromUrl.promptId : undefined)
    ?? asNonEmptyString(data?.promptId);
  const actionId = action?.actionId;
  const buttonAction: DeepLinkSessionAction | undefined =
    actionId === 'confirm' || actionId === 'cancel' ? actionId : undefined;
  return {
    type: 'session',
    sessionId,
    ...(fromUrl?.type === 'session' && fromUrl.directory ? { directory: fromUrl.directory } : {}),
    ...(promptId ? { promptId } : {}),
    ...(buttonAction ? { action: buttonAction } : {}),
  };
}
