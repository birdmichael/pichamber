import React from 'react';
import { CHAT_DRAFT_PROJECT_ID, isManagedChatDirectory } from '@/lib/chatDirectories';
import { isDesktopLocalOriginActive, isDesktopShell } from '@/lib/desktop';
import { desktopHostsGet, getDesktopHostApiUrl, locationMatchesHost, redactSensitiveUrl } from '@/lib/desktopHosts';
import { setDesktopWindowTitle } from '@/lib/desktopNative';
import { useI18n } from '@/lib/i18n';
import { normalizePath } from '@/lib/pathNormalization';
import { getRuntimeApiBaseUrl } from '@/lib/runtime-switch';
import { findOpenedProjectForDirectory } from '@/lib/workspaceLabel';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { getAttachedSessionDirectory } from '@/sync/session-worktree-contract';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionWorktreeStore } from '@/sync/session-worktree-store';

const APP_TITLE = 'Pichamber';

type WindowTitleProject = {
  id?: string;
  label?: string | null;
  path: string;
};

type WindowTitleDraft = {
  open?: boolean;
  target?: 'chat' | 'project';
  selectedProjectId?: string | null;
  directoryOverride?: string | null;
  bootstrapPendingDirectory?: string | null;
  preparedChatDirectory?: string | null;
};

type WindowTitleSource = {
  currentSessionId?: string | null;
  sessionDirectory?: string | null;
  worktreeDirectory?: string | null;
  worktreeProjectDirectory?: string | null;
  draft?: WindowTitleDraft | null;
  projects?: readonly WindowTitleProject[] | null;
  homeDirectory?: string | null;
};

const formatProjectLabel = (label: string): string => label.trim();

const nonempty = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getProjectNameFromPath = (path: string): string => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
};

const labelForProject = (project: WindowTitleProject): string | null => {
  const label = nonempty(project.label ?? null);
  if (label) return formatProjectLabel(label);
  const pathName = getProjectNameFromPath(project.path);
  return pathName ? formatProjectLabel(pathName) : null;
};

const openedProjectPathSet = (projects: readonly WindowTitleProject[]): Set<string> => {
  const paths = new Set<string>();
  for (const project of projects) {
    const normalized = normalizePath(project.path);
    if (normalized) paths.add(normalized);
  }
  return paths;
};

const isChatDraft = (draft?: WindowTitleDraft | null): boolean => {
  if (!draft?.open) return false;
  return draft.target === 'chat' || draft.selectedProjectId === CHAT_DRAFT_PROJECT_ID;
};

const isManagedChat = (
  directory: string | null | undefined,
  projects: readonly WindowTitleProject[],
  homeDirectory?: string | null,
): boolean => {
  const normalized = normalizePath(directory ?? null);
  if (!normalized) return false;
  return isManagedChatDirectory(normalized, homeDirectory, openedProjectPathSet(projects));
};

const matchOpenedProjectLabel = (
  directory: string | null | undefined,
  projects: readonly WindowTitleProject[],
): string | null => {
  const matched = findOpenedProjectForDirectory(projects, directory);
  return matched ? labelForProject(matched) : null;
};

const labelFromPath = (directory: string | null | undefined): string | null => {
  const normalized = normalizePath(directory ?? null);
  if (!normalized) return null;
  const pathName = getProjectNameFromPath(normalized);
  return pathName ? formatProjectLabel(pathName) : null;
};

const firstNormalized = (
  directories: Array<string | null | undefined>,
): string | null => directories.find((directory) => Boolean(normalizePath(directory ?? null))) ?? null;

const labelForWorkspaceDirectories = (
  visibleDirectories: Array<string | null | undefined>,
  projectDirectories: Array<string | null | undefined>,
  projects: readonly WindowTitleProject[],
  homeDirectory?: string | null,
): string | null => {
  if (visibleDirectories.some((directory) => isManagedChat(directory, projects, homeDirectory))) {
    return null;
  }
  for (const directory of [...visibleDirectories, ...projectDirectories]) {
    const matched = matchOpenedProjectLabel(directory, projects);
    if (matched) return matched;
  }
  return labelFromPath(firstNormalized(visibleDirectories));
};

/**
 * Workspace label for the OS/document title. Follows this window's visible
 * session or draft directory — never leftover persisted `activeProjectId`.
 */
export const resolveWindowTitleProjectLabel = (source: WindowTitleSource): string | null => {
  const projects = source.projects ?? [];

  if (source.currentSessionId) {
    return labelForWorkspaceDirectories(
      [source.worktreeDirectory, source.sessionDirectory],
      [source.worktreeProjectDirectory],
      projects,
      source.homeDirectory,
    );
  }

  if (isChatDraft(source.draft)) {
    return null;
  }

  if (source.draft?.open) {
    const selectedId = nonempty(source.draft.selectedProjectId ?? null);
    if (selectedId) {
      const selected = projects.find((project) => project.id === selectedId) ?? null;
      if (selected) return labelForProject(selected);
    }
    return labelForWorkspaceDirectories(
      [source.draft.bootstrapPendingDirectory, source.draft.directoryOverride],
      [],
      projects,
      source.homeDirectory,
    );
  }

  return null;
};

export const buildWindowTitle = (
  projectLabel: string | null,
  instanceLabel: string | null,
  draftLabel: string | null = null,
): string => {
  const workspaceLabel = nonempty(projectLabel) ?? nonempty(draftLabel);
  const parts = [workspaceLabel, nonempty(instanceLabel), APP_TITLE].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
  return parts.join(' | ');
};

export const useWindowTitle = () => {
  const { t } = useI18n();
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const newSessionDraft = useSessionUIStore((state) => state.newSessionDraft);
  const sessionDirectory = useSessionUIStore((state) => state.currentSessionDirectory);
  const worktreeAttachment = useSessionWorktreeStore((state) => (
    currentSessionId ? state.attachments.get(currentSessionId) : undefined
  ));
  const worktreeMeta = useSessionUIStore((state) => (
    currentSessionId ? state.worktreeMetadata.get(currentSessionId) ?? null : null
  ));
  const projects = useProjectsStore((state) => state.projects);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);

  const projectLabel = React.useMemo(() => resolveWindowTitleProjectLabel({
    currentSessionId,
    sessionDirectory,
    worktreeDirectory: getAttachedSessionDirectory(worktreeAttachment) ?? worktreeMeta?.path,
    worktreeProjectDirectory: worktreeMeta?.projectDirectory,
    draft: newSessionDraft,
    projects,
    homeDirectory,
  }), [
    currentSessionId,
    homeDirectory,
    newSessionDraft,
    projects,
    sessionDirectory,
    worktreeAttachment,
    worktreeMeta,
  ]);

  const draftLabel = newSessionDraft?.open ? t('sessions.switcher.draftTitle') : null;

  const [instanceLabel, setInstanceLabel] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !isDesktopShell()) {
      setInstanceLabel(null);
      return;
    }

    let cancelled = false;

    const refreshInstanceLabel = async () => {
      try {
        if (isDesktopLocalOriginActive()) {
          if (!cancelled) {
            setInstanceLabel(null);
          }
          return;
        }

        const localOrigin = window.__OPENCHAMBER_LOCAL_ORIGIN__ || window.location.origin;
        const runtimeApiBaseUrl = getRuntimeApiBaseUrl();

        if (runtimeApiBaseUrl && locationMatchesHost(runtimeApiBaseUrl, localOrigin)) {
          if (!cancelled) {
            setInstanceLabel(null);
          }
          return;
        }

        const cfg = await desktopHostsGet();
        const match = cfg.hosts.find((host) => runtimeApiBaseUrl ? locationMatchesHost(runtimeApiBaseUrl, getDesktopHostApiUrl(host)) : false);
        const nextLabel = match?.label?.trim() ? redactSensitiveUrl(match.label.trim()) : 'Instance';
        if (!cancelled) {
          setInstanceLabel(nextLabel);
        }
      } catch {
        if (!cancelled) {
          setInstanceLabel('Instance');
        }
      }
    };

    void refreshInstanceLabel();

    const handleFocus = () => {
      void refreshInstanceLabel();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const title = React.useMemo(
    () => buildWindowTitle(projectLabel, instanceLabel, draftLabel),
    [draftLabel, instanceLabel, projectLabel],
  );

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = title;
    }

    if (!isDesktopShell()) {
      return;
    }

    const applyTitle = async () => {
      try {
        const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent || '');
        if (isMac) {
          return;
        }

        await setDesktopWindowTitle(title);
      } catch {
        return;
      }
    };

    void applyTitle();
  }, [title]);
};
