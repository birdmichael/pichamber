import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { GitChangePath } from './GitChangePath';
import { splitGitChangePath } from './splitGitChangePath';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'GitChangePath.tsx'),
  'utf8',
);

const LONG_TEST_PATH = 'packages/ui/src/components/chat/__tests__/commandAutocompleteItems.test.ts';
const LONG_IMPL_PATH = 'packages/ui/src/components/chat/commandAutocompleteItems.ts';
const SHORT_NAME_PATH = 'packages/ui/src/components/sections/openchamber/DefaultsSettings.tsx';

describe('splitGitChangePath', () => {
  test('keeps a basename-only path as the filename', () => {
    expect(splitGitChangePath('README.md')).toEqual({ dir: null, name: 'README.md' });
  });

  test('splits the nearest parent from the filename', () => {
    expect(splitGitChangePath(SHORT_NAME_PATH)).toEqual({
      dir: 'packages/ui/src/components/sections/openchamber',
      name: 'DefaultsSettings.tsx',
    });
  });

  test('keeps a leading slash on the directory of an absolute path', () => {
    expect(splitGitChangePath('/commandAutocompleteItems.ts')).toEqual({
      dir: '',
      name: 'commandAutocompleteItems.ts',
    });
  });

  test('does not give an empty parent the remaining row width', () => {
    expect(source).toContain('if (!dir)');
    expect(source).toContain('dir === \'\' ? `/${name}` : name');
  });
});

describe('GitChangePath truncation contract', () => {
  test('directory left-truncates first; the filename stays shrink-0 nowrap', () => {
    expect(source).toContain("direction: 'rtl'");
    expect(source).toContain("unicodeBidi: 'isolate'");
    expect(source).not.toContain("unicodeBidi: 'plaintext'");
    expect(source).not.toContain('max-w-full');
    expect(source).toContain('shrink-0 whitespace-nowrap');
    expect(source).toContain('min-w-0 flex-1 truncate');
  });

  test('a long filename in a narrow box keeps the distinguishing tail in the name node', () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        'div',
        { className: 'w-24 min-w-0', style: { width: 96 } },
        React.createElement(GitChangePath, { path: LONG_TEST_PATH }),
        React.createElement(GitChangePath, { path: LONG_IMPL_PATH }),
        React.createElement(GitChangePath, { path: SHORT_NAME_PATH }),
      ),
    );

    expect(markup).toContain('commandAutocompleteItems.test.ts');
    expect(markup).toContain('commandAutocompleteItems.ts');
    expect(markup).toContain('DefaultsSettings.tsx');
    expect(markup).not.toContain('max-w-full');
    expect(markup).toContain('shrink-0 whitespace-nowrap');
    expect(markup).toContain('direction:rtl');
    expect(markup.match(/direction:rtl/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
