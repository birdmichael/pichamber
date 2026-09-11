import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'WorkStatusPinnedSection.tsx'),
  'utf-8',
);

describe('WorkStatusPinnedSection empty state', () => {
  test('renders an empty row when checked and there are no pins', () => {
    expect(source).toContain("t('chat.workStatus.pinned.empty')");
    expect(source).not.toMatch(/if \(pinned\.length === 0\) return null/);
    expect(source).toContain("useReportWorkStatusPresence('pinned', true)");
  });
});
