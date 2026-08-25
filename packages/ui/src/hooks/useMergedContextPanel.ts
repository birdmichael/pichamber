import React from 'react';

import {
  mergeContextPanelForBrowserScope,
  openedProjectPathSet,
  resolveBrowserScopeKey,
} from '@/lib/browser/scope';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';

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
  const sessionState = useUIStore((state) => (
    directoryKey ? state.contextPanelByDirectory[directoryKey] : undefined
  ));
  const scopeState = useUIStore((state) => (
    scopeKey ? state.contextPanelByDirectory[scopeKey] : undefined
  ));
  const panelState = React.useMemo(
    () => mergeContextPanelForBrowserScope(directoryKey, sessionState, scopeKey, scopeState),
    [directoryKey, sessionState, scopeKey, scopeState],
  );

  return { scopeKey, panelState };
};
