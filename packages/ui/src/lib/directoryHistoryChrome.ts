import { resolveVisibleProjectId, type NavigableProject } from '@/lib/projectNavigation';

export type DirectoryHistoryChromePlan =
  | { kind: 'noop' }
  | {
      kind: 'restore-project';
      projectId: string;
      projectPath: string;
      /** First sync session for the directory, if any; otherwise open a project draft. */
      sessionId: string | null;
    };

/**
 * After directory Back/Forward, decide how to resync project chrome + session.
 * Directory history only stores paths; Previous/Next Project also set active
 * project and session, so Back/Forward must mirror that without calling
 * `setActiveProject` (which would push another directory history entry).
 */
export function planDirectoryHistoryChrome(input: {
  projects: readonly NavigableProject[];
  currentDirectory?: string | null;
  homeDirectory?: string | null;
  sessions?: readonly { id: string }[] | null;
}): DirectoryHistoryChromePlan {
  const projectId = resolveVisibleProjectId({
    projects: input.projects,
    currentDirectory: input.currentDirectory,
    homeDirectory: input.homeDirectory,
  });
  if (!projectId) {
    return { kind: 'noop' };
  }

  const project = input.projects.find((entry) => entry.id === projectId);
  if (!project) {
    return { kind: 'noop' };
  }

  const sessionId = input.sessions?.[0]?.id ?? null;
  return {
    kind: 'restore-project',
    projectId: project.id,
    projectPath: project.path,
    sessionId: typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null,
  };
}
