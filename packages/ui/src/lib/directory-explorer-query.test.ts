import { expect, test } from 'bun:test';

import {
  expandTildeDirectoryPath,
  normalizeDirectoryExplorerQuery,
  resolveDirectoryExplorerQuery,
  shouldFetchDirectoryExplorerListing,
} from './directory-explorer-query';

test('treats a bare tilde as the home directory, not a ~ filter', () => {
  expect(normalizeDirectoryExplorerQuery('~')).toBe('~/');
  expect(resolveDirectoryExplorerQuery('~', '/home/ada')).toEqual({
    directory: '/home/ada',
    filter: '',
  });
  expect(resolveDirectoryExplorerQuery('~/', '/home/ada')).toEqual({
    directory: '/home/ada',
    filter: '',
  });
});

test('lists home from ~/ even before the client knows $HOME', () => {
  expect(resolveDirectoryExplorerQuery('~/', '')).toEqual({
    directory: '~/',
    filter: '',
  });
  expect(shouldFetchDirectoryExplorerListing('~/', '')).toBe(true);
});

test('filters a leaf under ~ and expands when home is known', () => {
  expect(resolveDirectoryExplorerQuery('~/Doc', '/home/ada')).toEqual({
    directory: '/home/ada',
    filter: 'Doc',
  });
  expect(resolveDirectoryExplorerQuery('~/Documents/', '/home/ada')).toEqual({
    directory: '/home/ada/Documents/',
    filter: '',
  });
});

test('leaves absolute paths alone', () => {
  expect(resolveDirectoryExplorerQuery('/workspace/', '/home/ada')).toEqual({
    directory: '/workspace/',
    filter: '',
  });
  expect(expandTildeDirectoryPath('/workspace/', '/home/ada')).toBe('/workspace/');
});
