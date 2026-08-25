import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitGitChangePath } from './GitChangePath';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'GitChangePath.tsx'),
  'utf8',
);

describe('splitGitChangePath', () => {
  test('keeps a basename-only path as the filename', () => {
    expect(splitGitChangePath('README.md')).toEqual({ dir: null, name: 'README.md' });
  });

  test('splits the nearest parent from the filename', () => {
    expect(splitGitChangePath('packages/ui/src/components/sections/openchamber/DefaultsSettings.tsx')).toEqual({
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
  test('left-truncates the parent without plaintext bidi, and does not clip the filename', () => {
    expect(source).toContain("direction: 'rtl'");
    expect(source).toContain("unicodeBidi: 'isolate'");
    expect(source).not.toContain("unicodeBidi: 'plaintext'");
    expect(source).toContain('min-w-0 max-w-full shrink-0 truncate');
    expect(source).not.toContain('overflow-hidden');
  });
});
