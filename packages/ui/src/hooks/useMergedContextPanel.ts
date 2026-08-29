import React from 'react';

import {
  mergeContextPanelChatScope,
  mergeContextPanelForBrowserScope,
  openedProjectPathSet,
  resolveBrowserScopeKey,
} from '@/lib/browser/scope';
import { contextChatScopeKey } from '@/lib/subagents/childSession';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

/**
 * Session-directory context-panel state with browser tabs taken from the
 * project/chats scope when that key differs from the session directory.
 */
export const useMergedContextPanel = (directoryKey: string) => {
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const projects = useProjectsStore((state) => state.projects);
  const openedProjectPaths = React.useMemo(
    () => openedProjectPathSet(projects.map((project) => project.path)),
    [projects],
  );
  const scopeKey = React.useMemo(
    () => resolveBrowserScopeKey(directoryKey, homeDirectory, openedProjectPaths),
    [directoryKey, homeDirectory, openedProjectPaths],
  );
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const chatScopeKey = React.useMemo(
    () => contextChatScopeKey(currentSessionId),
    [currentSessionId],
  );
  const sessionState = useUIStore((state) => (
    directoryKey ? state.contextPanelByDirectory[directoryKey] : undefined
  ));
  const scopeState = useUIStore((state) => (
    scopeKey ? state.contextPanelByDirectory[scopeKey] : undefined
  ));
  const chatState = useUIStore((state) => (
    chatScopeKey ? state.contextPanelByDirectory[chatScopeKey] : undefined
  ));
  const panelState = React.useMemo(
    () => mergeContextPanelChatScope(
      directoryKey,
      mergeContextPanelForBrowserScope(directoryKey, sessionState, scopeKey, scopeState),
      chatScopeKey,
      chatState,
    ),
    [chatScopeKey, chatState, directoryKey, scopeKey, scopeState, sessionState],
  );

  return { scopeKey, chatScopeKey, panelState };
};
