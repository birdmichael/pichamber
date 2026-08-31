import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'SessionNodeItem.tsx'),
  'utf8',
);

const handler = source.slice(source.indexOf('const handleExportPiSession'));
const handlerBody = handler.slice(0, handler.indexOf('const handleOpenMiniChatWindow'));

describe('session JSONL/HTML export toast', () => {
  test('waits for the native Save dialog before claiming success', () => {
    expect(source).toContain('exportSessionTextFile');
    expect(source).toContain('exportFiltersForFormat');
    expect(handlerBody).toContain("if (result.status === 'canceled')");
    expect(handlerBody).toContain("if (result.status === 'saved')");
    expect(handlerBody).not.toMatch(/downloadTextFile\([\s\S]*toast\.success/);
  });
});
