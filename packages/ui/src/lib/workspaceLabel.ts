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
  projects: readonly { label?: string | null; path: string }[];
  homeDirectory?: string | null;
  sessionDirectory?: string | null;
  draftProject?: { label?: string | null; path: string } | null;
  preferSessionProject?: boolean;
}): string | null {
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

  if (input.draftProject) {
    return getProjectDisplayLabel(input.draftProject, input.homeDirectory);
  }

  return null;
}
