import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'BulkActionBar.tsx'),
  'utf8',
);

describe('BulkActionBar archive icon', () => {
  test('active-session destructive action uses archive icon, not delete-bin', () => {
    expect(source).toContain("archivedBucket ? 'delete-bin' : 'archive'");
    expect(source).toContain("t('sessions.sidebar.bulkActions.archive')");
  });
});
