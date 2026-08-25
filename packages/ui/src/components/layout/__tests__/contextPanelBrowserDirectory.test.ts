/**
 * BrowserPane must receive the real session directory. Stores already remap
 * tabs and address history; annotation drafts and announced servers key on
 * the session path, not `openchamber:chats`.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contextPanelSource = readFileSync(join(__dirname, '..', 'ContextPanel.tsx'), 'utf-8');

describe('context panel BrowserPane directory', () => {
  test('passes the session directory, not the browser scope key', () => {
    expect(contextPanelSource).toContain('<BrowserPane initialUrl={tab.targetPath ?? \'\'} directory={directoryKey} tabID={tab.id} />');
    expect(contextPanelSource).not.toContain('directory={scopeKey');
    expect(contextPanelSource).not.toContain("directory={scopeKey || directoryKey}");
  });
});
