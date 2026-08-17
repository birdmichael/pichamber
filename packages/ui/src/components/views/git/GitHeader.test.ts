import { describe, expect, test } from 'bun:test';

import { resolveGitHeaderPullRequestControl } from './GitHeader';

describe('resolveGitHeaderPullRequestControl', () => {
  test('offers create when the git header can open PR and none exists', () => {
    expect(resolveGitHeaderPullRequestControl({
      canOpenPullRequest: true,
      hasPullRequest: false,
    })).toBe('create');
  });

  test('offers the numbered chip when a pull request already exists', () => {
    expect(resolveGitHeaderPullRequestControl({
      canOpenPullRequest: true,
      hasPullRequest: true,
    })).toBe('open');
  });

  test('hides both controls when the PR surface cannot be opened', () => {
    expect(resolveGitHeaderPullRequestControl({
      canOpenPullRequest: false,
      hasPullRequest: false,
    })).toBe(null);
    expect(resolveGitHeaderPullRequestControl({
      canOpenPullRequest: false,
      hasPullRequest: true,
    })).toBe(null);
  });
});
