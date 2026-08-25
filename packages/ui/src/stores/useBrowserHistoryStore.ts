import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { getRuntimeKey } from '@/lib/runtime-switch';
import {
  recordVisit,
  forgetVisit,
  type BrowserHistoryEntry,
} from '@/lib/browser/history';
import { openedProjectPathSet, resolveBrowserScopeKey } from '@/lib/browser/scope';
import { createDeferredSafeJSONStorage } from './utils/safeStorage';
import { useDirectoryStore } from './useDirectoryStore';
import { useProjectsStore } from './useProjectsStore';

/**
 * Addresses visited in the browser panel, kept per project or the shared
 * Chats bucket. Isolated chat session directories collapse onto one key.
 *
 * Scoped by runtime as well as directory: the same path on a remote instance is
 * a different machine with different servers on it, and offering one's
 * addresses while connected to the other would be a suggestion that cannot work.
 */
const MAX_PROJECTS = 20;

type BrowserHistoryState = {
  byProject: Record<string, BrowserHistoryEntry[]>;
  recordVisit: (directory: string, visit: { url: string; title?: string }) => void;
  forget: (directory: string, url: string) => void;
  clear: (directory: string) => void;
};

const projectKey = (directory: string): string => {
  const home = useDirectoryStore.getState().homeDirectory;
  const opened = openedProjectPathSet(
    useProjectsStore.getState().projects.map((project) => project.path),
  );
  const scoped = resolveBrowserScopeKey(directory, home, opened);
  return scoped ? JSON.stringify([getRuntimeKey(), scoped]) : '';
};

/** Keeps the projects visited most recently; the rest are not worth carrying. */
const evictOldestProjects = (
  byProject: Record<string, BrowserHistoryEntry[]>,
): Record<string, BrowserHistoryEntry[]> => {
  const keys = Object.keys(byProject);
  if (keys.length <= MAX_PROJECTS) return byProject;

  const ranked = keys
    .map((key) => [key, byProject[key]?.[0]?.lastVisitedAt ?? 0] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PROJECTS);
  return Object.fromEntries(ranked.map(([key]) => [key, byProject[key] ?? []]));
};

export const useBrowserHistoryStore = create<BrowserHistoryState>()(
  persist(
    (set) => ({
      byProject: {},

      recordVisit: (directory, visit) => {
        const key = projectKey(directory);
        if (!key) return;
        set((state) => {
          const current = state.byProject[key] ?? [];
          const next = recordVisit(current, { ...visit, at: Date.now() });
          if (next === current) return state;
          return { byProject: evictOldestProjects({ ...state.byProject, [key]: next }) };
        });
      },

      forget: (directory, url) => {
        const key = projectKey(directory);
        if (!key) return;
        set((state) => {
          const current = state.byProject[key];
          if (!current) return state;
          return { byProject: { ...state.byProject, [key]: forgetVisit(current, url) } };
        });
      },

      clear: (directory) => {
        const key = projectKey(directory);
        if (!key) return;
        set((state) => {
          if (!(key in state.byProject)) return state;
          const byProject = { ...state.byProject };
          delete byProject[key];
          return { byProject };
        });
      },
    }),
    {
      name: 'openchamber-browser-history',
      version: 1,
      storage: createDeferredSafeJSONStorage(),
      partialize: (state) => ({ byProject: state.byProject }),
    },
  ),
);

/** Reads one project's history. Returns a stable empty list when there is none. */
const EMPTY: readonly BrowserHistoryEntry[] = [];

export const selectBrowserHistory = (directory: string) => (
  (state: BrowserHistoryState): readonly BrowserHistoryEntry[] => {
    const key = projectKey(directory);
    return (key ? state.byProject[key] : undefined) ?? EMPTY;
  }
);
