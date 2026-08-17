export type GitHeaderPullRequestControl = 'create' | 'open' | null;

/**
 * Desktop Git header PR entry: numbered chip when a PR exists, create control
 * when the repo is git and there is no PR yet. Null when the surface cannot
 * be opened (no directory / no handler).
 */
export function resolveGitHeaderPullRequestControl(input: {
  canOpenPullRequest: boolean;
  hasPullRequest: boolean;
}): GitHeaderPullRequestControl {
  if (!input.canOpenPullRequest) return null;
  return input.hasPullRequest ? 'open' : 'create';
}
