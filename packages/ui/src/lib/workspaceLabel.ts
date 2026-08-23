import { CHAT_DRAFT_PROJECT_ID, isChatDirectoryPath, isManagedChatDirectory } from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';
import { formatDirectoryName } from '@/lib/utils';

/**
 * Same friendly workspace name the session sidebar uses: an explicit project
 * label, `~` for the home folder, otherwise the last path segment.
 */
export function getProjectDisplayLabel(
  project: { label?: string | null; path: string },
  homeDirectory?: string | null,
): string {
  return project.label?.trim()
    || formatDirectoryName(project.path, homeDirectory)
    || project.path;
}

export function findOpenedProjectForDirectory<T extends { path: string }>(
  projects: readonly T[],
  directory: string | null | undefined,
): T | null {
  const normalizedDirectory = normalizePath(directory ?? null);
  if (!normalizedDirectory) return null;

  const matches = projects
    .map((project) => ({ project, path: normalizePath(project.path) }))
    .filter(({ path }) => {
      if (!path) return false;
      if (normalizedDirectory === path) return true;
      if (path === '/') return normalizedDirectory.startsWith('/');
      return normalizedDirectory.startsWith(`${path}/`);
    })
    .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0));

  return matches[0]?.project ?? null;
}

export function resolveWelcomeWorkspaceLabel(input: {
  projects: readonly { id?: string; label?: string | null; path: string; kind?: 'chat' | 'project' }[];
  homeDirectory?: string | null;
  sessionDirectory?: string | null;
  draftProject?: { id?: string; label?: string | null; path: string; kind?: 'chat' | 'project' } | null;
  preferSessionProject?: boolean;
}): string | null {
  const openedProjectPaths = new Set(
    input.projects
      .map((project) => normalizePath(project.path))
      .filter((path): path is string => Boolean(path)),
  );
  const isChatDraft = input.draftProject?.kind === 'chat' || input.draftProject?.id === CHAT_DRAFT_PROJECT_ID;
  if (isChatDraft && !input.preferSessionProject) return null;
  if (isChatDirectoryPath(input.sessionDirectory) || isManagedChatDirectory(input.sessionDirectory, input.homeDirectory, openedProjectPaths)) {
    return null;
  }

  if (input.preferSessionProject) {
    const matched = findOpenedProjectForDirectory(input.projects, input.sessionDirectory);
    if (matched) return getProjectDisplayLabel(matched, input.homeDirectory);
    if (input.sessionDirectory) {
      return formatDirectoryName(input.sessionDirectory, input.homeDirectory);
    }
    if (input.draftProject) {
      return getProjectDisplayLabel(input.draftProject, input.homeDirectory);
    }
    return null;
  }

  if (input.draftProject && input.draftProject.kind !== 'chat' && input.draftProject.id !== CHAT_DRAFT_PROJECT_ID) {
    return getProjectDisplayLabel(input.draftProject, input.homeDirectory);
  }

  return null;
}
