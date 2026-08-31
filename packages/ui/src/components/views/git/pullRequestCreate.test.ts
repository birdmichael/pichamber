import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canEnablePullRequestCreate, isPushableLocalBranch } from './pullRequestCreate';

const here = dirname(fileURLToPath(import.meta.url));

describe('isPushableLocalBranch', () => {
  test('accepts a real local branch name', () => {
    expect(isPushableLocalBranch('feature/pr-410')).toBe(true);
    expect(isPushableLocalBranch('refs/heads/main')).toBe(true);
    expect(isPushableLocalBranch('main', 'branch')).toBe(true);
  });

  test('rejects missing names and the literal HEAD ref', () => {
    // git status on detached HEAD: `## HEAD (no branch)` → current is "HEAD".
    expect(isPushableLocalBranch(null)).toBe(false);
    expect(isPushableLocalBranch(undefined)).toBe(false);
    expect(isPushableLocalBranch('')).toBe(false);
    expect(isPushableLocalBranch('   ')).toBe(false);
    expect(isPushableLocalBranch('HEAD')).toBe(false);
    expect(isPushableLocalBranch('refs/heads/HEAD')).toBe(false);
  });

  test('rejects detached and unborn headState even when a label is present', () => {
    expect(isPushableLocalBranch('HEAD', 'detached')).toBe(false);
    expect(isPushableLocalBranch('e4a4bf7', 'detached')).toBe(false);
    expect(isPushableLocalBranch('main', 'unborn')).toBe(false);
  });
});

describe('canEnablePullRequestCreate', () => {
  const ready = {
    isCreating: false,
    isConnected: true,
    targetBaseBranch: 'main',
    headBranch: 'feature/pr-410',
    headState: 'branch' as const,
    useDetectedUpstream: false,
  };

  test('enables create on a real local branch that differs from the base', () => {
    expect(canEnablePullRequestCreate(ready)).toBe(true);
  });

  test('disables create when HEAD is presented as the local branch', () => {
    expect(canEnablePullRequestCreate({
      ...ready,
      headBranch: 'HEAD',
    })).toBe(false);
  });

  test('disables create on detached HEAD even if GitHub is connected', () => {
    expect(canEnablePullRequestCreate({
      ...ready,
      headBranch: 'HEAD',
      headState: 'detached',
    })).toBe(false);
    expect(canEnablePullRequestCreate({
      ...ready,
      headBranch: 'e4a4bf7',
      headState: 'detached',
    })).toBe(false);
  });

  test('disables create until a real local branch exists (unborn / missing)', () => {
    expect(canEnablePullRequestCreate({
      ...ready,
      headBranch: '',
      headState: 'unborn',
    })).toBe(false);
    expect(canEnablePullRequestCreate({
      ...ready,
      headBranch: null,
    })).toBe(false);
  });

  test('keeps the existing same-base and connection guards', () => {
    expect(canEnablePullRequestCreate({
      ...ready,
      headBranch: 'main',
    })).toBe(false);
    expect(canEnablePullRequestCreate({
      ...ready,
      isConnected: false,
    })).toBe(false);
    expect(canEnablePullRequestCreate({
      ...ready,
      targetBaseBranch: '  ',
    })).toBe(false);
    expect(canEnablePullRequestCreate({
      ...ready,
      isCreating: true,
    })).toBe(false);
  });

  test('allows a fork PR onto the same-named base through detected upstream', () => {
    expect(canEnablePullRequestCreate({
      ...ready,
      headBranch: 'main',
      useDetectedUpstream: true,
    })).toBe(true);
  });
});

describe('PR create panel wiring', () => {
  test('does not treat HEAD as a pushable local branch in the create form', () => {
    const view = readFileSync(join(here, '../PullRequestView.tsx'), 'utf8');
    const section = readFileSync(join(here, 'PullRequestSection.tsx'), 'utf8');

    expect(view).toContain("from './git/pullRequestCreate'");
    expect(view).toContain('isPushableLocalBranch(currentBranch, headState)');
    expect(view).toContain("t('gitView.pullRequest.detachedHeadHint')");
    expect(view).not.toMatch(/if \(!currentDirectory \|\| !currentBranch\)/);

    expect(section).toContain('canEnablePullRequestCreate');
    expect(section).toContain('isPushableLocalBranch(branch, headState)');
    expect(section).toContain("t('gitView.pullRequest.detachedHeadHint')");
    expect(section).not.toContain('disabled={isCreating || !isConnected || !targetBaseBranch.trim() || (!useDetectedUpstream && targetBaseBranch.trim() === branch)}');
  });
});
