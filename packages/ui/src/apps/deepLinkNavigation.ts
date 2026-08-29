import React from 'react';

import { isCapacitorApp } from '@/lib/platform';
import { cancelPiExtensionUi, isPiExtensionUiNotFoundError, replyPiExtensionUi } from '@/sync/pi-extension-ui';
import { requestPiExtensionUiFocus } from '@/sync/pi-extension-ui-store';
import { useSessionUIStore } from '@/sync/session-ui-store';

import { intentFromPushAction, parseDeepLink, type DeepLinkIntent, type SessionsFilter, type ViewTarget } from './deepLinks';

const settlePiUiFromNotification = async (
  sessionId: string,
  promptId: string,
  action: 'confirm' | 'cancel',
): Promise<void> => {
  try {
    if (action === 'confirm') {
      await replyPiExtensionUi(sessionId, promptId, true);
      return;
    }
    await cancelPiExtensionUi(sessionId, promptId);
  } catch (error) {
    if (isPiExtensionUiNotFoundError(error)) return;
    // Transport/auth failure: the in-app card/dialog is the retry surface.
  }
};

/**
 * Navigation layer for {@link DeepLinkIntent}s — the only place that knows how to *apply* a
 * deep link. Producers (notification taps, widget `widgetURL`, Live Activities) feed intents
 * in via {@link useDeepLinkSource}; the surfaces that can satisfy them register imperative
 * handlers via {@link useDeepLinkHandlers}. Session/new-session navigation goes straight to
 * the session store (always available), so those resolve even before the shell has mounted.
 *
 * Intents that arrive before the app is ready (cold launch from a tap/widget) or before their
 * handler is registered are stashed in a module-level holder that survives the connect flow
 * and SyncProvider remount, then applied as soon as the app becomes ready / the handler
 * appears. Only the most recent intent is kept (newest wins) — a burst of taps shouldn't queue.
 */

export interface DeepLinkHandlers {
  /** Open the sessions sheet, optionally pre-filtered (filter support is best-effort for now). */
  openSessions?: (filter?: SessionsFilter) => void;
  /** Open a non-session surface (files / mcp / instances / update). */
  openView?: (target: ViewTarget) => void;
  /** Open the Changes surface, optionally jumping straight to a file diff. */
  openChanges?: (options?: { path?: string; staged?: boolean }) => void;
  /** Open Settings, optionally at a specific section. */
  openSettings?: (section?: string) => void;
}

let handlers: DeepLinkHandlers = {};
let ready = false;
let pending: DeepLinkIntent | null = null;

const execute = (intent: DeepLinkIntent): boolean => {
  switch (intent.type) {
    case 'session':
      void useSessionUIStore.getState().setCurrentSession(intent.sessionId, intent.directory ?? null);
      if (intent.promptId) {
        requestPiExtensionUiFocus(intent.promptId);
      }
      if (intent.promptId && (intent.action === 'confirm' || intent.action === 'cancel')) {
        void settlePiUiFromNotification(intent.sessionId, intent.promptId, intent.action);
      }
      return true;

    case 'new-session': {
      const store = useSessionUIStore.getState();
      store.openNewSessionDraft();
      if (intent.directory || intent.projectId) {
        store.setNewSessionDraftTarget({
          directoryOverride: intent.directory ?? null,
          projectId: intent.projectId ?? null,
          selectedProjectId: intent.projectId ?? null,
        });
      }
      return true;
    }

    case 'sessions':
      if (!handlers.openSessions) return false;
      handlers.openSessions(intent.filter);
      return true;

    case 'status':
      // The old input-bar status panel is gone — recent sessions with statuses
      // now live in the sessions drawer, so route status links there.
      if (!handlers.openSessions) return false;
      handlers.openSessions();
      return true;

    case 'view':
      if (!handlers.openView) return false;
      handlers.openView(intent.target);
      return true;

    case 'changes':
      if (!handlers.openChanges) return false;
      handlers.openChanges({ path: intent.path, staged: intent.staged });
      return true;

    case 'settings':
      if (!handlers.openSettings) return false;
      handlers.openSettings(intent.section);
      return true;
  }
};

const flush = (): void => {
  if (!ready || !pending) return;
  const intent = pending;
  // Drop the stash before executing; if the handler isn't registered yet, execute() returns
  // false and we re-stash so a later registerDeepLinkHandlers() flush can retry it.
  pending = null;
  if (!execute(intent)) {
    pending = intent;
  }
};

/** Apply an intent now if possible, otherwise stash it until the app is ready / a handler appears. */
const applyDeepLinkIntent = (intent: DeepLinkIntent): void => {
  pending = intent;
  flush();
};

/** Convenience: parse a raw `pichamber://…` (or leftover `openchamber://…`) URL and apply it. No-op for unrecognised URLs. */
const applyDeepLinkUrl = (raw: string | null | undefined): void => {
  const intent = parseDeepLink(raw);
  if (intent) {
    applyDeepLinkIntent(intent);
  }
};

const setReady = (value: boolean): void => {
  ready = value;
  flush();
};

/**
 * Register the surfaces that can satisfy shell-scoped intents (sessions/settings/views/changes).
 * Call from the component that owns those panels; the handlers are torn down on unmount.
 * Registering also flushes any pending intent that was waiting for these handlers.
 */
export const useDeepLinkHandlers = (next: DeepLinkHandlers): void => {
  React.useEffect(() => {
    handlers = next;
    flush();
    return () => {
      if (handlers === next) {
        handlers = {};
      }
    };
  }, [next]);
};

/**
 * Single native entry point for deep links. Subscribes to both the custom URL scheme
 * (`App.appUrlOpen` — widgets, Live Activities, external links) and notification taps
 * (`pushNotificationActionPerformed`), normalising each into a {@link DeepLinkIntent}.
 * Both listeners are registered UNCONDITIONALLY so a cold-launch tap/open isn't lost while
 * the app is still connecting; intents stash until `ready` (connected + initialized).
 */
export const useDeepLinkSource = (options: { ready: boolean }): void => {
  const { ready: isReady } = options;

  React.useEffect(() => {
    setReady(isReady);
  }, [isReady]);

  React.useEffect(() => {
    if (!isCapacitorApp()) return;
    let disposed = false;
    const cleanup: Array<() => void> = [];

    void import('@capacitor/app')
      .then(async ({ App }) => {
        if (disposed) return;
        const handle = await App.addListener('appUrlOpen', (event) => {
          applyDeepLinkUrl(event?.url);
        });
        if (disposed) {
          void handle.remove();
          return;
        }
        cleanup.push(() => void handle.remove());
      })
      .catch(() => undefined);

    void import('@capacitor/push-notifications')
      .then(async ({ PushNotifications }) => {
        if (disposed) return;
        const handle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const intent = intentFromPushAction(action);
          if (intent) applyDeepLinkIntent(intent);
        });
        if (disposed) {
          void handle.remove();
          return;
        }
        cleanup.push(() => void handle.remove());
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      cleanup.forEach((remove) => remove());
    };
  }, []);
};
