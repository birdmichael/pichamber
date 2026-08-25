import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ChangeRow.tsx'),
  'utf8',
);

describe('ChangeRow path display', () => {
  test('uses GitChangePath instead of an inline RTL/plaintext path', () => {
    expect(source).toContain('<GitChangePath path={file.path} />');
    expect(source).not.toContain("unicodeBidi: 'plaintext'");
  });
});
