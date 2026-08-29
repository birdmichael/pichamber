import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contextPanelSource = readFileSync(join(__dirname, './ContextPanel.tsx'), 'utf-8');
const mergedHookSource = readFileSync(join(__dirname, '../../hooks/useMergedContextPanel.ts'), 'utf-8');

describe('ContextPanel close control', () => {
  test('header X closes the session-scoped child chat as well as the directory panel', () => {
    expect(contextPanelSource).toContain('chatScopeKey');
    expect(contextPanelSource).toMatch(/closeContextPanel\(directoryKey\)/);
    expect(contextPanelSource).toMatch(/closeContextPanel\(chatScopeKey\)/);
    expect(contextPanelSource).toContain("t('contextPanel.actions.closePanel')");
    expect(mergedHookSource).toMatch(/return \{ scopeKey, chatScopeKey, panelState \}/);
  });
});
