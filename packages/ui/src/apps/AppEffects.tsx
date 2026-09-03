import React from 'react';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { usePwaManifestSync } from '@/hooks/usePwaManifestSync';
import { useQueuedMessageAutoSend } from '@/hooks/useQueuedMessageAutoSend';
import { useSessionAutoCleanup } from '@/hooks/useSessionAutoCleanup';
import { useWindowControlsOverlayLayout } from '@/hooks/useWindowControlsOverlayLayout';
import { isDesktopShell } from '@/lib/desktop';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { refreshGlobalSessions, resolveGlobalSessionDirectory } from '@/stores/useGlobalSessionsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { clearLastActiveSession, readLastActiveSession } from '@/sync/last-session-cache';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { setOptimisticRefs } from '@/sync/session-actions';
import { markSessionViewed } from '@/sync/notification-store';
import { setExternallyViewedSession } from '@/sync/sync-context';
import { useSync } from '@/sync/use-sync';
import { PiExtensionUiNotifyToasts } from '@/components/chat/PiExtensionUiNotifyToasts';

const MINI_CHAT_PRESENCE_CHANNEL = 'openchamber:mini-chat-presence';

type MiniChatPresenceMessage = {
  type?: string;
  sessionId?: string;
  directory?: string;
  viewed?: boolean;
};

const SyncOptimisticBridge: React.FC = () => {
  const sync = useSync();
  const addRef = React.useRef(sync.optimistic.add);
  const removeRef = React.useRef(sync.optimistic.remove);
  const confirmRef = React.useRef(sync.optimistic.confirm);
  addRef.current = sync.optimistic.add;
  removeRef.current = sync.optimistic.remove;
  confirmRef.current = sync.optimistic.confirm;

  React.useEffect(() => {
    setOptimisticRefs(
      (input) => addRef.current(input),
      (input) => removeRef.current(input),
      (input) => confirmRef.current(input),
    );
  }, []);

  return null;
};

const MiniChatPresenceBridge: React.FC = () => {
  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(MINI_CHAT_PRESENCE_CHANNEL);
    channel.onmessage = (event) => {
      const data = event.data as MiniChatPresenceMessage | null;
      if (data?.type !== 'mini-chat-session-presence' || !data.sessionId || !data.directory) {
        return;
      }

      const viewed = data.viewed !== false;
      setExternallyViewedSession(data.directory, data.sessionId, viewed);
      if (viewed) {
        markSessionViewed(data.sessionId);
      }
    };

    return () => channel.close();
  }, []);

  return null;
};

export function SyncRuntimeEffects({ embeddedBackgroundWorkEnabled }: {
  embeddedBackgroundWorkEnabled: boolean;
}) {
  useSessionAutoCleanup(embeddedBackgroundWorkEnabled);
  useQueuedMessageAutoSend(embeddedBackgroundWorkEnabled);

  return <SyncOptimisticBridge />;
}

const DesktopLastSessionRestore: React.FC = () => {
  const isConnected = useConfigStore((s) => s.isConnected);
  const doneRef = React.useRef(false);

  React.useEffect(() => {
    if (!isDesktopShell() || !isConnected || doneRef.current) return;
    if (useSessionUIStore.getState().currentSessionId) {
      doneRef.current = true;
      return;
    }
    const runtimeKey = getRuntimeKey();
    const persisted = readLastActiveSession(runtimeKey);
    if (!persisted) {
      doneRef.current = true;
      return;
    }
    let cancelled = false;
    void (async () => {
      const snapshot = await refreshGlobalSessions().catch(() => null);
      if (cancelled) return;
      if (!snapshot) return;
      doneRef.current = true;
      const session = snapshot.activeSessions.find((entry) => entry.id === persisted.sessionId);
      if (!session) {
        clearLastActiveSession(runtimeKey);
        return;
      }
      const latest = useSessionUIStore.getState();
      if (!latest.currentSessionId) {
        void latest.setCurrentSession(
          session.id,
          resolveGlobalSessionDirectory(session) ?? persisted.directory ?? undefined,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected]);

  return null;
};

export function SyncAppEffects({ embeddedBackgroundWorkEnabled }: {
  embeddedBackgroundWorkEnabled: boolean;
}) {
  usePwaManifestSync();
  useWindowControlsOverlayLayout();
  useKeyboardShortcuts();

  return (
    <>
      <SyncRuntimeEffects embeddedBackgroundWorkEnabled={embeddedBackgroundWorkEnabled} />
      <MiniChatPresenceBridge />
      <PiExtensionUiNotifyToasts />
      <DesktopLastSessionRestore />
    </>
  );
}
