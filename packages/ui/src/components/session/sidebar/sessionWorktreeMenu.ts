import type { WorktreeMetadata } from '@/types/worktree';
import { normalizePath } from '@/lib/pathNormalization';

export type SessionWorktreeMenuTarget = {
  metadata: WorktreeMetadata;
  isPrimary: boolean;
  isCurrent: boolean;
};

const compareLinkedTargets = (a: SessionWorktreeMenuTarget, b: SessionWorktreeMenuTarget): number => {
  const aLabel = a.metadata.branch || a.metadata.name || a.metadata.label || a.metadata.path;
  const bLabel = b.metadata.branch || b.metadata.name || b.metadata.label || b.metadata.path;
  const labelCompare = aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base' });
  if (labelCompare !== 0) {
    return labelCompare;
  }

  return a.metadata.path.localeCompare(b.metadata.path, undefined, { sensitivity: 'base' });
};

const buildFallbackLabel = (path: string): string => {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

const cloneMetadata = (metadata: WorktreeMetadata): WorktreeMetadata => ({
  ...metadata,
  path: normalizePath(metadata.path) ?? metadata.path,
  projectDirectory: normalizePath(metadata.projectDirectory) ?? metadata.projectDirectory,
  worktreeRoot: normalizePath(metadata.worktreeRoot ?? metadata.path) ?? metadata.worktreeRoot,
});

const buildSyntheticWorktreeMetadata = (args: {
  path: string;
  projectDirectory: string;
  currentWorktree: WorktreeMetadata | null;
  projectRootBranch?: string | null;
}): WorktreeMetadata => {
  const { currentWorktree, path, projectDirectory, projectRootBranch } = args;
  const currentPath = normalizePath(currentWorktree?.path ?? null);
  const isCurrentPath = currentPath === path;
  const syntheticBranch = isCurrentPath ? (currentWorktree?.branch ?? '') : (projectRootBranch ?? '');

  const syntheticMetadata: WorktreeMetadata = {
    path,
    projectDirectory,
    branch: syntheticBranch,
    label: isCurrentPath
      ? (currentWorktree?.label || currentWorktree?.branch || currentWorktree?.name || buildFallbackLabel(path))
      : (projectRootBranch || buildFallbackLabel(path)),
    name: isCurrentPath ? currentWorktree?.name : undefined,
    worktreeRoot: isCurrentPath
      ? (normalizePath(currentWorktree?.worktreeRoot ?? path) ?? path)
      : path,
    worktreeStatus: isCurrentPath
      ? (currentWorktree?.worktreeStatus ?? 'ready')
      : 'ready',
    worktreeSource: isCurrentPath
      ? (currentWorktree?.worktreeSource ?? 'existing')
      : 'existing',
    headState: isCurrentPath ? currentWorktree?.headState : (projectRootBranch ? 'branch' : undefined),
  };

  return isCurrentPath && currentWorktree
    ? { ...currentWorktree, ...syntheticMetadata }
    : syntheticMetadata;
};

export const buildSessionWorktreeMenuTargets = (args: {
  projectPath: string | null;
  discoveredWorktrees: ReadonlyArray<WorktreeMetadata>;
  sourceDirectory: string | null;
  currentWorktree: WorktreeMetadata | null;
  projectRootBranch?: string | null;
}): SessionWorktreeMenuTarget[] => {
  const normalizedProjectPath = normalizePath(args.projectPath ?? null);
  const normalizedSourceDirectory = normalizePath(args.sourceDirectory ?? null)
    ?? normalizePath(args.currentWorktree?.path ?? null);
  const discoveredPrimaryPath = normalizePath(
    args.discoveredWorktrees.find((worktree) => normalizePath(worktree.projectDirectory ?? null))?.projectDirectory ?? null,
  );
  const currentPrimaryPath = normalizePath(args.currentWorktree?.projectDirectory ?? null);
  const primaryPath = discoveredPrimaryPath ?? currentPrimaryPath ?? normalizedProjectPath;

  const targetsByPath = new Map<string, SessionWorktreeMenuTarget>();
  const pushTarget = (target: SessionWorktreeMenuTarget): void => {
    const normalizedPath = normalizePath(target.metadata.path ?? null);
    if (!normalizedPath || targetsByPath.has(normalizedPath)) {
      return;
    }
    targetsByPath.set(normalizedPath, {
      ...target,
      metadata: cloneMetadata({
        ...target.metadata,
        path: normalizedPath,
      }),
    });
  };

  for (const worktree of args.discoveredWorktrees) {
    const normalizedPath = normalizePath(worktree.path ?? null);
    if (!normalizedPath) {
      continue;
    }
    pushTarget({
      metadata: cloneMetadata({
        ...worktree,
        path: normalizedPath,
        projectDirectory: normalizePath(worktree.projectDirectory ?? null) ?? primaryPath ?? normalizedProjectPath ?? normalizedPath,
      }),
      isPrimary: primaryPath === normalizedPath,
      isCurrent: normalizedSourceDirectory === normalizedPath,
    });
  }

  if (primaryPath && !targetsByPath.has(primaryPath)) {
    pushTarget({
      metadata: buildSyntheticWorktreeMetadata({
        path: primaryPath,
        projectDirectory: primaryPath,
        currentWorktree: args.currentWorktree,
        projectRootBranch: args.projectRootBranch,
      }),
      isPrimary: true,
      isCurrent: normalizedSourceDirectory === primaryPath,
    });
  }

  if (normalizedSourceDirectory && !targetsByPath.has(normalizedSourceDirectory)) {
    pushTarget({
      metadata: buildSyntheticWorktreeMetadata({
        path: normalizedSourceDirectory,
        projectDirectory: primaryPath ?? normalizedProjectPath ?? normalizedSourceDirectory,
        currentWorktree: args.currentWorktree,
        projectRootBranch: args.projectRootBranch,
      }),
      isPrimary: primaryPath === normalizedSourceDirectory,
      isCurrent: true,
    });
  }

  const primaryTargets: SessionWorktreeMenuTarget[] = [];
  const linkedTargets: SessionWorktreeMenuTarget[] = [];
  for (const target of targetsByPath.values()) {
    if (target.isPrimary) {
      primaryTargets.push(target);
      continue;
    }
    linkedTargets.push(target);
  }

  primaryTargets.sort((a, b) => a.metadata.path.localeCompare(b.metadata.path, undefined, { sensitivity: 'base' }));
  linkedTargets.sort(compareLinkedTargets);
  return [...primaryTargets, ...linkedTargets];
};
