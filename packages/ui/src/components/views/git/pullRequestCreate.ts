export type GitHeadState = 'branch' | 'detached' | 'unborn';

const normalizeLocalBranchName = (branch: string | null | undefined): string => {
  if (typeof branch !== 'string') {
    return '';
  }

  let name = branch.trim();
  if (name.startsWith('refs/heads/')) {
    name = name.slice('refs/heads/'.length);
  }
  if (name.startsWith('heads/')) {
    name = name.slice('heads/'.length);
  }
  return name.trim();
};

/**
 * A local name we can push as a PR head. Detached HEAD (`git status`:
 * `## HEAD (no branch)`) is reported as `current === 'HEAD'` and is not a
 * branch. Unborn HEAD has no commits to push either.
 */
export function isPushableLocalBranch(
  branch: string | null | undefined,
  headState?: GitHeadState | null,
): boolean {
  if (headState === 'detached' || headState === 'unborn') {
    return false;
  }
  const name = normalizeLocalBranchName(branch);
  return Boolean(name) && name !== 'HEAD';
}

/**
 * Create-PR button enablement. HEAD / detached / unborn must not count as a
 * pushable local branch even when GitHub is connected and a base is selected.
 */
export function canEnablePullRequestCreate(input: {
  isCreating: boolean;
  isConnected: boolean;
  targetBaseBranch: string;
  headBranch: string | null | undefined;
  headState?: GitHeadState | null;
  useDetectedUpstream: boolean;
}): boolean {
  if (input.isCreating || !input.isConnected) {
    return false;
  }
  const base = input.targetBaseBranch.trim();
  if (!base) {
    return false;
  }
  if (!isPushableLocalBranch(input.headBranch, input.headState)) {
    return false;
  }
  const head = normalizeLocalBranchName(input.headBranch);
  if (!input.useDetectedUpstream && base === head) {
    return false;
  }
  return true;
}
