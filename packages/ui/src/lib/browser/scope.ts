import { CHAT_DRAFT_PROJECT_ID, isManagedChatDirectory } from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';

/**
 * Browser tabs and address history are scoped by Settings project, with one
 * extra bucket for projectless Chats.
 *
 * Isolated `.../chats/date/session-*` directories and home-as-chat collapse
 * onto `CHAT_DRAFT_PROJECT_ID`. Home that is itself an opened Settings project
 * stays a project key. Worktree paths are left as-is; this helper does not
 * guess a parent project.
 */
export function resolveBrowserScopeKey(
  directory: string | null | undefined,
  home: string | null | undefined,
  openedProjectPaths?: ReadonlySet<string> | null,
): string {
  const normalized = normalizePath(directory ?? null);
  if (!normalized) return '';
  if (normalized === CHAT_DRAFT_PROJECT_ID) return CHAT_DRAFT_PROJECT_ID;
  if (isManagedChatDirectory(normalized, home, openedProjectPaths)) {
    return CHAT_DRAFT_PROJECT_ID;
  }
  return normalized;
}

export function openedProjectPathSet(
  paths: Iterable<string | null | undefined> | null | undefined,
): Set<string> {
  const opened = new Set<string>();
  for (const path of paths ?? []) {
    const normalized = normalizePath(path ?? null);
    if (normalized) opened.add(normalized);
  }
  return opened;
}

export const isBrowserTabIdentity = (tabID: string | null | undefined): boolean => {
  if (!tabID) return false;
  return tabID === 'browser' || tabID.startsWith('browser:');
};

type BrowserScopedTab = {
  id: string;
  mode: string;
};

export type BrowserScopedPanelState<T extends BrowserScopedTab> = {
  isOpen: boolean;
  expanded: boolean;
  tabs: T[];
  activeTabId: string | null;
  widthByMode: Partial<Record<string, number>>;
  touchedAt: number;
};

/**
 * Legacy helper: browser tabs now live on the session directory, same as
 * Files / Git / notes. Callers that still merge a leftover project/chats
 * bucket keep this so old persisted keys do not vanish mid-session.
 *
 * Same key (or the same object) is returned unchanged so a normal project
 * session is not double-counted.
 */
export function mergeContextPanelForBrowserScope<T extends BrowserScopedTab>(
  sessionKey: string,
  sessionState: BrowserScopedPanelState<T> | undefined,
  scopeKey: string,
  scopeState: BrowserScopedPanelState<T> | undefined,
): BrowserScopedPanelState<T> | undefined {
  if (!sessionKey) return undefined;
  if (!scopeKey || scopeKey === sessionKey || sessionState === scopeState) {
    return sessionState;
  }

  if (!sessionState && !scopeState) return undefined;

  const sessionTabs = sessionState?.tabs ?? [];
  const scopeTabs = scopeState?.tabs ?? [];
  const nonBrowserTabs = sessionTabs.filter((tab) => tab.mode !== 'browser');
  const scopeBrowserTabs = scopeTabs.filter((tab) => tab.mode === 'browser');
  const seen = new Set(scopeBrowserTabs.map((tab) => tab.id));
  const leftoverSessionBrowserTabs = sessionTabs.filter(
    (tab) => tab.mode === 'browser' && !seen.has(tab.id),
  );
  const tabs = [...nonBrowserTabs, ...scopeBrowserTabs, ...leftoverSessionBrowserTabs];

  if (!sessionState && tabs.length === 0) return undefined;

  const base = sessionState ?? {
    isOpen: false,
    expanded: false,
    tabs,
    activeTabId: null,
    widthByMode: {},
    touchedAt: scopeState?.touchedAt ?? Date.now(),
  };

  const requestedActiveTabId = sessionState?.activeTabId ?? null;
  const activeTabId = requestedActiveTabId && tabs.some((tab) => tab.id === requestedActiveTabId)
    ? requestedActiveTabId
    : (tabs[tabs.length - 1]?.id ?? null);

  return {
    ...base,
    tabs,
    activeTabId,
    widthByMode: {
      ...sessionState?.widthByMode,
      ...(scopeState?.widthByMode.browser != null
        ? { browser: scopeState.widthByMode.browser }
        : {}),
    },
  };
}

/**
 * Subagent chat tabs and browser tabs follow the parent session, not the
 * project directory. When a session scope exists, directory-scoped leftover
 * chat/browser tabs stay hidden so switching conversations cannot keep
 * another session's page or child chat open.
 */
export function mergeContextPanelChatScope<T extends BrowserScopedTab>(
  sessionKey: string,
  sessionState: BrowserScopedPanelState<T> | undefined,
  chatScopeKey: string,
  chatState: BrowserScopedPanelState<T> | undefined,
): BrowserScopedPanelState<T> | undefined {
  if (!sessionKey) return undefined;
  if (!chatScopeKey) return sessionState;
  if (chatScopeKey === sessionKey || sessionState === chatState) {
    return sessionState;
  }

  const sessionTabs = (sessionState?.tabs ?? []).filter(
    (tab) => tab.mode !== 'chat' && tab.mode !== 'browser',
  );
  const scopedTabs = (chatState?.tabs ?? []).filter(
    (tab) => tab.mode === 'chat' || tab.mode === 'browser',
  );
  const tabs = [...sessionTabs, ...scopedTabs];

  if (!sessionState && tabs.length === 0) return undefined;

  const base = sessionState ?? {
    isOpen: false,
    expanded: false,
    tabs,
    activeTabId: null,
    widthByMode: {},
    touchedAt: chatState?.touchedAt ?? Date.now(),
  };

  const sessionTouched = sessionState?.touchedAt ?? 0;
  const chatTouched = chatState?.touchedAt ?? 0;
  const requestedActiveTabId = chatTouched >= sessionTouched
    ? (chatState?.activeTabId ?? sessionState?.activeTabId ?? null)
    : (sessionState?.activeTabId ?? chatState?.activeTabId ?? null);
  const activeTabId = requestedActiveTabId && tabs.some((tab) => tab.id === requestedActiveTabId)
    ? requestedActiveTabId
    : (scopedTabs[scopedTabs.length - 1]?.id ?? sessionState?.activeTabId ?? tabs[tabs.length - 1]?.id ?? null);

  return {
    ...base,
    isOpen: sessionState?.isOpen || Boolean(chatState?.isOpen && scopedTabs.length > 0),
    tabs,
    activeTabId,
  };
}
