import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'SessionNodeItem.tsx'),
  'utf8',
);

describe('SessionNodeItem parentID tree', () => {
  test('draws a chevron only when the node has children', () => {
    expect(source).toContain('const hasChildren = node.children.length > 0');
    expect(source).toContain('const subsessionChevron = hasChildren ? (');
    expect(source).toContain('{hasChildren && isExpanded');
  });

  test('row click opens the session in the main chat via handleSessionSelect', () => {
    expect(source).toContain('handleSessionSelect(session.id, sessionDirectory)');
    expect(source).not.toMatch(/handleRowSelect[\s\S]{0,400}openContextPanelTab/);
    expect(source).not.toContain('openSubagentChildSession');
  });

  test('Open in Side Panel uses the current window session scope', () => {
    expect(source).toContain('openSessionInSidePanel');
    expect(source).toContain('readContextPanelDirectoryKey');
    expect(source).toContain('currentSessionID: useSessionUIStore.getState().currentSessionId');
  });
});
