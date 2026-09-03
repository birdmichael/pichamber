import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'SessionNodeItem.tsx'),
  'utf8',
);

const footerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'SidebarFooter.tsx'),
  'utf8',
);

describe('sidebar first-click activation', () => {
  test('session rows activate on primary pointerdown and ignore the following click', () => {
    expect(source).toContain('activateTitlebarIconOnPointerDown');
    expect(source).toContain('ignoreRowClickRef');
  });

  test('the Settings gear activates on primary pointerdown like session rows', () => {
    expect(footerSource).toContain('activateTitlebarIconOnPointerDown');
    expect(footerSource).toContain('ignoreSettingsClickRef');
    expect(footerSource).toContain('onPointerDown={handleSettingsPointerDown}');
    expect(footerSource).toContain('onClick={handleSettingsClick}');
    expect(footerSource).toContain('markSettingsOpenedFromTrigger');
    expect(footerSource).toMatch(/activate:\s*\(\)\s*=>\s*\{[\s\S]*markSettingsOpenedFromTrigger[\s\S]*onOpenSettings/);
  });
});

describe('sidebar session rename', () => {
  test('Enter commits the draft the same way as the check button', () => {
    expect(source).toContain("if (event.key === 'Enter')");
    expect(source).toContain('handleSaveEdit(renameDraft)');
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('event.stopPropagation()');
  });
});
