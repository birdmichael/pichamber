import { CHAT_DRAFT_PROJECT_ID, isManagedChatDirectory } from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

export type InheritedNewSessionDraftOptions = {
  directoryOverride: string;
  selectedProjectId?: string;
};

export type InheritedNewSessionDraftInput = {
  currentSessionId?: string | null;
  currentSessionDirectory?: string | null;
  homeDirectory?: string | null;
  openedProjectPaths?: Iterable<string | null | undefined> | null;
  activeProjectId?: string | null;
  activeProjectPath?: string | null;
};

const openedProjectPathSet = (
  openedProjectPaths?: Iterable<string | null | undefined> | null,
): Set<string> => {
  const paths = new Set<string>();
  for (const path of openedProjectPaths ?? []) {
    const normalized = normalizePath(path ?? null);
    if (normalized) paths.add(normalized);
  }
  return paths;
};

const directoryBelongsToOpenedProject = (
  directory: string,
  openedProjectPaths: ReadonlySet<string>,
): boolean => {
  for (const path of openedProjectPaths) {
    if (directory === path) return true;
    if (path === '/') {
      if (directory.startsWith('/')) return true;
      continue;
    }
    if (directory.startsWith(`${path}/`)) return true;
  }
  return false;
};

/**
 * New session while in a project follows that project.
 *
 * 1. Current session belongs to an opened project (root or worktree) → directoryOverride.
 * 2. Else if an active project is set → selectedProjectId + that path.
 * 3. Else → undefined so `openNewSessionDraft()` stays a projectless chat.
 */
export function resolveInheritedNewSessionDraftOptions(
  input: InheritedNewSessionDraftInput,
): InheritedNewSessionDraftOptions | undefined {
  const currentSessionDirectory = normalizePath(input.currentSessionDirectory ?? null);
  const openedProjectPaths = openedProjectPathSet(input.openedProjectPaths);

  if (
    input.currentSessionId
    && currentSessionDirectory
  ) {
    if (isManagedChatDirectory(currentSessionDirectory, input.homeDirectory, openedProjectPaths)) {
      // Explicit projectless / chats session: do not fall back to a leftover
      // activeProject from a previous workspace (#555).
      return undefined;
    }
    // Home/`~` that is not an opened Settings project is a projectless chat.
    // Do not inherit it as a project workspace even if homeDirectory is unset.
    if (directoryBelongsToOpenedProject(currentSessionDirectory, openedProjectPaths)) {
      return { directoryOverride: currentSessionDirectory };
    }
    // Current session directory is neither managed-chat nor an opened project
    // (e.g. arbitrary folder). Stay projectless rather than using leftover active.
    return undefined;
  }

  const activeProjectId = typeof input.activeProjectId === 'string' ? input.activeProjectId.trim() : '';
  const activeProjectPath = normalizePath(input.activeProjectPath ?? null);
  if (activeProjectId && activeProjectPath) {
    return {
      selectedProjectId: activeProjectId,
      directoryOverride: activeProjectPath,
    };
  }

  return undefined;
}

/** Read live session/project state at call time. Do not cache this across a click. */
export function readInheritedNewSessionDraftOptions(): InheritedNewSessionDraftOptions | undefined {
  const { currentSessionId, currentSessionDirectory } = useSessionUIStore.getState();
  const { homeDirectory } = useDirectoryStore.getState();
  const { projects, getActiveProject } = useProjectsStore.getState();
  const activeProject = getActiveProject();

  return resolveInheritedNewSessionDraftOptions({
    currentSessionId,
    currentSessionDirectory,
    homeDirectory,
    openedProjectPaths: projects.map((project) => project.path),
    activeProjectId: activeProject?.id ?? null,
    activeProjectPath: activeProject?.path ?? null,
  });
}

export type MiniChatDraftWindowArgs = {
  directory: string;
  projectId: string | null;
};

export type OpenNewSessionDraftMiniChatInput = {
  open: boolean;
  target?: 'chat' | 'project' | null;
  selectedProjectId?: string | null;
  directoryOverride?: string | null;
  bootstrapPendingDirectory?: string | null;
};


/** True when an open New Session draft is chats-/projectless (Choose project). */
export function isProjectlessNewSessionDraft(
  draft: OpenNewSessionDraftMiniChatInput | null | undefined,
): boolean {
  if (!draft?.open) return false;
  const selectedProjectId = typeof draft.selectedProjectId === 'string'
    ? draft.selectedProjectId.trim()
    : '';
  return draft.target === 'chat'
    || !selectedProjectId
    || selectedProjectId === CHAT_DRAFT_PROJECT_ID;
}

/**
 * When a New Session draft is open, Mini Chat must follow that draft — not
 * leftover activeProject from a previous workspace (#555).
 * Projectless chat draft → empty args; project draft → that path/id.
 * Returns null when no draft is open so callers can fall back to inherit.
 */
export function mapOpenNewSessionDraftToMiniChatArgs(
  draft: OpenNewSessionDraftMiniChatInput | null | undefined,
): MiniChatDraftWindowArgs | null {
  if (!draft?.open) return null;

  if (isProjectlessNewSessionDraft(draft)) {
    return { directory: '', projectId: null };
  }

  const selectedProjectId = typeof draft.selectedProjectId === 'string'
    ? draft.selectedProjectId.trim()
    : '';
  const directory = normalizePath(
    draft.bootstrapPendingDirectory ?? draft.directoryOverride ?? null,
  ) ?? '';
  return {
    directory,
    projectId: selectedProjectId,
  };
}

export function mapInheritedNewSessionDraftToMiniChatArgs(
  inherit: InheritedNewSessionDraftOptions | undefined,
): MiniChatDraftWindowArgs {
  if (!inherit) return { directory: '', projectId: null };
  return {
    directory: inherit.directoryOverride ?? '',
    projectId: inherit.selectedProjectId ?? null,
  };
}

/**
 * Mini Chat draft windows follow the open New Session draft when present;
 * otherwise session/activeProject inherit. Never mix leftover activeProject
 * with a projectless draft (#555).
 */
export function readMiniChatDraftWindowArgs(): MiniChatDraftWindowArgs {
  const draft = useSessionUIStore.getState().newSessionDraft;
  const fromDraft = mapOpenNewSessionDraftToMiniChatArgs(draft);
  if (fromDraft) return fromDraft;
  return mapInheritedNewSessionDraftToMiniChatArgs(readInheritedNewSessionDraftOptions());
}
