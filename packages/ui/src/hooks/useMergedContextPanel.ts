import React from 'react';

import { mergeContextPanelChatScope } from '@/lib/browser/scope';
import { contextChatScopeKey } from '@/lib/subagents/childSession';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

/**
 * Session-directory context-panel state. Browser and subagent chat tabs
 * merge from `session:<id>` so two conversations in the same project do
 * not share a page.
 */
export const useMergedContextPanel = (directoryKey: string) => {
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const chatScopeKey = React.useMemo(
    () => contextChatScopeKey(currentSessionId),
    [currentSessionId],
  );
  const sessionState = useUIStore((state) => (
    directoryKey ? state.contextPanelByDirectory[directoryKey] : undefined
  ));
  const chatState = useUIStore((state) => (
    chatScopeKey ? state.contextPanelByDirectory[chatScopeKey] : undefined
  ));
  const panelState = React.useMemo(
    () => mergeContextPanelChatScope(
      directoryKey,
      sessionState,
      chatScopeKey,
      chatState,
    ),
    [chatScopeKey, chatState, directoryKey, sessionState],
  );

  return { scopeKey: directoryKey, chatScopeKey, panelState };
};
