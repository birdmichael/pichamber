import { CHAT_DRAFT_PROJECT_ID, isManagedChatDirectory } from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';
import { isProjectlessNewSessionDraft } from '@/lib/newSessionInherit';

export type MiniChatHeaderProject = {
  label?: string | null;
  path: string;
};

const compactLastSegment = (path: string): string => {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? path;
};

/**
 * Prefer the session/draft directory's project. Never show leftover
 * activeProject / path-matched scan-proj for a projectless chats draft (#555).
 */
export function resolveMiniChatHeaderProjectLabel(input: {
  pathMatchedProject: MiniChatHeaderProject | null;
  activeProject: MiniChatHeaderProject | null;
  directoryLabel: string;
  draftTarget?: 'chat' | 'project' | null;
  draftSelectedProjectId?: string | null;
  sessionDirectory?: string | null;
  homeDirectory?: string | null;
  openedProjectPaths?: Iterable<string | null | undefined> | null;
}): string {
  const openedProjectPaths = new Set<string>();
  for (const path of input.openedProjectPaths ?? []) {
    const normalized = normalizePath(path ?? null);
    if (normalized) openedProjectPaths.add(normalized);
  }

  const draftOpen = input.draftTarget != null;
  if (draftOpen && isProjectlessNewSessionDraft({
    open: true,
    target: input.draftTarget,
    selectedProjectId: input.draftSelectedProjectId ?? (
      input.draftTarget === 'chat' ? CHAT_DRAFT_PROJECT_ID : null
    ),
  })) {
    // Projectless New Session / Mini Chat chrome — ignore leftover directory
    // matches and persisted activeProject (subtitle was still scan-proj).
    return 'Pichamber';
  }

  const skipLeftoverActiveProject = input.draftTarget === 'chat'
    || isManagedChatDirectory(input.sessionDirectory, input.homeDirectory, openedProjectPaths);
  const project = input.pathMatchedProject ?? (skipLeftoverActiveProject ? null : input.activeProject);
  if (!project) return input.directoryLabel || 'Pichamber';
  const label = project.label?.trim();
  if (label) return label;
  return compactLastSegment(project.path);
}
