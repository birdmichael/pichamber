import { expect, test } from 'bun:test';

import {
  applyDirectoryExplorerQueryEdit,
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

test('drops a ~/ prefix when the remainder is an absolute path', () => {
  expect(normalizeDirectoryExplorerQuery('~/tmp/existing')).toBe('~/tmp/existing');
  expect(normalizeDirectoryExplorerQuery('~//tmp/existing')).toBe('/tmp/existing');
  expect(normalizeDirectoryExplorerQuery('~//tmp/existing/')).toBe('/tmp/existing/');
  expect(normalizeDirectoryExplorerQuery('~//')).toBe('/');
  expect(resolveDirectoryExplorerQuery('~//tmp/existing', '/home/ada')).toEqual({
    directory: '/tmp/',
    filter: 'existing',
  });
  expect(resolveDirectoryExplorerQuery('~//tmp/existing/', '/home/ada')).toEqual({
    directory: '/tmp/existing/',
    filter: '',
  });
  expect(shouldFetchDirectoryExplorerListing(
    resolveDirectoryExplorerQuery('~//tmp/existing', '/home/ada').directory,
    '/home/ada',
  )).toBe(true);
});

test('drops a ~/ prefix when the remainder is a Windows volume root', () => {
  expect(normalizeDirectoryExplorerQuery('~/C:/Users/ada/src')).toBe('C:/Users/ada/src');
  expect(resolveDirectoryExplorerQuery('~/C:/Users/ada/src', 'C:/Users/ada')).toEqual({
    directory: 'C:/Users/ada/',
    filter: 'src',
  });
  expect(normalizeDirectoryExplorerQuery('~/D:\\Projects\\app')).toBe('D:\\Projects\\app');
});

test('drops ~/ when a slash is inserted at the caret', () => {
  expect(applyDirectoryExplorerQueryEdit('~/', '/')).toBe('/');
  expect(applyDirectoryExplorerQueryEdit('~/', '/tmp/pichamber-409')).toBe('/tmp/pichamber-409');
  expect(applyDirectoryExplorerQueryEdit('~/', 'Documents')).toBe('~/Documents');
  expect(applyDirectoryExplorerQueryEdit('~/', '/', 2, 2)).toBe('/');
});
