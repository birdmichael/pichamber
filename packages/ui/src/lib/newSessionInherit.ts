import { isManagedChatDirectory } from '@/lib/chatDirectories';
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

/**
 * New session while in a project follows that project.
 *
 * 1. Current session is a non-managed-chat project session → directoryOverride.
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
    && !isManagedChatDirectory(currentSessionDirectory, input.homeDirectory, openedProjectPaths)
  ) {
    return { directoryOverride: currentSessionDirectory };
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
