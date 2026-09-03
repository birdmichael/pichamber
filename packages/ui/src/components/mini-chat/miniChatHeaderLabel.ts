import { isManagedChatDirectory } from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';

export type MiniChatHeaderProject = {
  label?: string | null;
  path: string;
};

const compactLastSegment = (path: string): string => {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? path;
};

/** Prefer the session/draft directory's project. Do not show leftover activeProject for chats drafts. */
export function resolveMiniChatHeaderProjectLabel(input: {
  pathMatchedProject: MiniChatHeaderProject | null;
  activeProject: MiniChatHeaderProject | null;
  directoryLabel: string;
  draftTarget?: 'chat' | 'project' | null;
  sessionDirectory?: string | null;
  homeDirectory?: string | null;
  openedProjectPaths?: Iterable<string | null | undefined> | null;
}): string {
  const openedProjectPaths = new Set<string>();
  for (const path of input.openedProjectPaths ?? []) {
    const normalized = normalizePath(path ?? null);
    if (normalized) openedProjectPaths.add(normalized);
  }
  const skipLeftoverActiveProject = input.draftTarget === 'chat'
    || isManagedChatDirectory(input.sessionDirectory, input.homeDirectory, openedProjectPaths);
  const project = input.pathMatchedProject ?? (skipLeftoverActiveProject ? null : input.activeProject);
  if (!project) return input.directoryLabel || 'Pichamber';
  const label = project.label?.trim();
  if (label) return label;
  return compactLastSegment(project.path);
}
