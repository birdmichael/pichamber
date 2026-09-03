import { isManagedChatDirectory } from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';

export type NavigableProject = {
  id: string;
  path: string;
};

export const resolveVisibleProjectId = (input: {
  projects: readonly NavigableProject[];
  currentDirectory?: string | null;
  homeDirectory?: string | null;
}): string | null => {
  const directory = normalizePath(input.currentDirectory ?? null);
  if (!directory) return null;
  const openedPaths = new Set(
    input.projects.map((project) => normalizePath(project.path)).filter((path): path is string => Boolean(path)),
  );
  if (isManagedChatDirectory(directory, input.homeDirectory ?? null, openedPaths)) {
    return null;
  }
  for (const project of input.projects) {
    const path = normalizePath(project.path);
    if (!path) continue;
    if (directory === path || directory.startsWith(`${path}/`)) return project.id;
  }
  return null;
};

export const pickAdjacentProject = (
  projects: readonly NavigableProject[],
  visibleProjectId: string | null,
  direction: -1 | 1,
): NavigableProject | null => {
  if (projects.length === 0) return null;
  if (visibleProjectId == null) {
    return direction > 0 ? projects[0] : projects[projects.length - 1];
  }
  const currentIndex = projects.findIndex((project) => project.id === visibleProjectId);
  if (currentIndex < 0) {
    return direction > 0 ? projects[0] : projects[projects.length - 1];
  }
  return projects[(currentIndex + direction + projects.length) % projects.length] ?? null;
};
