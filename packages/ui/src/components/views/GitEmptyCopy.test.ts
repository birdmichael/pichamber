import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const read = (relativePath: string) => readFileSync(join(here, relativePath), 'utf8');

const sliceBetween = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe('Git and Changes not-repo empty copy', () => {
  test('desktop Git empty state has no init or open-repo control', () => {
    const gitView = read('GitView.tsx');
    const notGitReturn = sliceBetween(
      gitView,
      "{t('gitView.empty.notGitRepository')}",
      "{t('gitView.empty.worktreeFeaturesUnavailable')}",
    );

    expect(gitView).toContain("t('gitView.empty.notGitRepositoryDescription')");
    expect(notGitReturn).not.toMatch(/<Button\b/);
    expect(notGitReturn).not.toMatch(/onClick|git init|initializeGit|openRepository/i);
  });

  test('Changes empty state reuses the same copy and has no init control', () => {
    const mobile = read('../../apps/MobileChangesSurface.tsx');
    expect(mobile).toContain(
      "description={t('gitView.empty.notGitRepositoryDescription')}",
    );

    const emptyState = sliceBetween(
      mobile,
      'const MobileChangesState:',
      'const MobileDiffDetail:',
    );
    expect(emptyState).not.toMatch(/<Button\b|<button\b/);
  });
});
