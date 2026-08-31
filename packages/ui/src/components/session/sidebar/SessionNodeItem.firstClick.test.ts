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

  test('the Settings gear still activates on pointerdown so it cannot double-open', () => {
    expect(footerSource).toContain('activateTitlebarIconOnPointerDown');
    expect(footerSource).toContain('ignoreSettingsClickRef');
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
