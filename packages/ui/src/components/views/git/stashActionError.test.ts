import { describe, expect, test } from 'bun:test';
import {
  clipGitErrorForToast,
  extractLocalChangesOverwritePaths,
  formatOverwritePathsLabel,
  parseStashActionError,
  summarizeStashActionError,
} from './stashActionError';

const STATUS_DUMP = `On branch main
Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
	new file:   file1.txt
	new file:   file2.txt
	new file:   file3.txt
	new file:   file4.txt
	new file:   file5.txt
	new file:   file6.txt
	new file:   file7.txt
	new file:   file8.txt
	new file:   file9.txt
	new file:   file10.txt

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   notes.txt
`;

const OVERWRITE_WITH_STATUS = `error: Your local changes to the following files would be overwritten by merge:
	notes.txt
Please commit your changes or stash them before you merge.
Aborting
${STATUS_DUMP}`;

const INDEX_OVERWRITE_WITH_STATUS = `error: Your local changes to the following files would be overwritten by merge:
	notes.txt
Please commit your changes or stash them before you merge.
Aborting
Index was not unstashed.
${STATUS_DUMP}`;

describe('extractLocalChangesOverwritePaths', () => {
  test('extracts the conflicting path from a stash apply status dump', () => {
    expect(extractLocalChangesOverwritePaths(OVERWRITE_WITH_STATUS)).toEqual(['notes.txt']);
  });

  test('extracts multiple conflicting paths', () => {
    const raw = `error: Your local changes to the following files would be overwritten by merge:
	a.txt
	dir/b.ts
	c.md
Please commit your changes or stash them before you merge.
Aborting
`;
    expect(extractLocalChangesOverwritePaths(raw)).toEqual(['a.txt', 'dir/b.ts', 'c.md']);
  });

  test('handles checkout wording and ignores trailing status', () => {
    const raw = `error: Your local changes to the following files would be overwritten by checkout:
	readme.md
Aborting
${STATUS_DUMP}`;
    expect(extractLocalChangesOverwritePaths(raw)).toEqual(['readme.md']);
  });

  test('returns empty when there is no overwrite section', () => {
    expect(extractLocalChangesOverwritePaths('fatal: stash@{9} is not a valid reference')).toEqual([]);
  });
});

describe('clipGitErrorForToast', () => {
  test('drops the status encyclopedia and keeps the error line', () => {
    const clipped = clipGitErrorForToast(OVERWRITE_WITH_STATUS);
    expect(clipped).toContain('would be overwritten');
    expect(clipped).not.toContain('new file:');
    expect(clipped).not.toContain('Changes to be committed');
    expect(clipped.length).toBeLessThan(220);
  });

  test('clips other long stderr without status markers', () => {
    const long = `fatal: ${'x'.repeat(400)}`;
    const clipped = clipGitErrorForToast(long, 80);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(80);
  });

  test('returns empty for pure status noise', () => {
    expect(clipGitErrorForToast(STATUS_DUMP)).toBe('');
  });
});

describe('parseStashActionError', () => {
  test('prefers overwrite paths over a clipped dump', () => {
    expect(parseStashActionError(new Error(INDEX_OVERWRITE_WITH_STATUS))).toEqual({
      kind: 'overwrite',
      paths: ['notes.txt'],
    });
  });

  test('falls back to a clipped message', () => {
    expect(parseStashActionError('fatal: stash@{9} is not a valid reference')).toEqual({
      kind: 'message',
      text: 'fatal: stash@{9} is not a valid reference',
    });
  });
});

describe('summarizeStashActionError', () => {
  const formatters = {
    fallback: 'Failed to apply stash',
    formatOverwrite: (paths: string) => `Local changes would be overwritten (${paths}); commit or stash first`,
    formatOverwriteWithMore: (paths: string, count: number) =>
      `Local changes would be overwritten (${paths}, +${count} more); commit or stash first`,
  };

  test('names the conflicting path for apply/pop conflicts', () => {
    expect(summarizeStashActionError(OVERWRITE_WITH_STATUS, formatters)).toBe(
      'Local changes would be overwritten (notes.txt); commit or stash first',
    );
  });

  test('caps listed paths and reports extras', () => {
    const raw = `error: Your local changes to the following files would be overwritten by merge:
	a.txt
	b.txt
	c.txt
	d.txt
Please commit your changes or stash them before you merge.
Aborting
`;
    expect(summarizeStashActionError(raw, formatters)).toBe(
      'Local changes would be overwritten (a.txt, b.txt, c.txt, +1 more); commit or stash first',
    );
  });

  test('uses fallback when there is nothing useful', () => {
    expect(summarizeStashActionError(STATUS_DUMP, formatters)).toBe('Failed to apply stash');
  });

  test('keeps a short non-conflict error readable', () => {
    expect(summarizeStashActionError('fatal: stash@{9} is not a valid reference', formatters)).toBe(
      'fatal: stash@{9} is not a valid reference',
    );
  });
});

describe('formatOverwritePathsLabel', () => {
  test('dedupes and caps', () => {
    expect(formatOverwritePathsLabel(['a', 'a', 'b', 'c', 'd'], 3)).toEqual({
      pathsLabel: 'a, b, c',
      extraCount: 1,
    });
  });
});
