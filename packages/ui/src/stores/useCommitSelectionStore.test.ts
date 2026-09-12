import { expect, test } from 'bun:test';
import { commitSelectionKey, useCommitSelectionStore } from './useCommitSelectionStore';
import type { GitLogEntry } from '@/lib/api/types';

const sample = (hash: string): GitLogEntry => ({
  hash,
  date: '2026-09-09T09:22:00Z',
  message: 'test',
  refs: '',
  body: '',
  author_name: 'Test',
  author_email: 'test@example.com',
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  parents: [],
});

test('remembers commit selection per runtime/directory/branch', () => {
  const key = commitSelectionKey('/tmp/repo', 'main', 'local');
  useCommitSelectionStore.getState().select(key, sample('a'.repeat(40)));
  expect(useCommitSelectionStore.getState().selections.get(key)?.hash).toBe('a'.repeat(40));
  useCommitSelectionStore.getState().select(key, sample('b'.repeat(40)));
  expect(useCommitSelectionStore.getState().selections.get(key)?.hash).toBe('b'.repeat(40));
});
