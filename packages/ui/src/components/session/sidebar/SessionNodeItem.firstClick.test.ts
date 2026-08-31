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

  test('the Settings gear opens on click, not pointerdown, so the backdrop cannot eat the press', () => {
    expect(footerSource).toContain('handleSettingsClick');
    expect(footerSource).toContain('markSettingsOpenedFromTrigger');
    expect(footerSource).toContain('onClick={handleSettingsClick}');
    expect(footerSource).toContain('onPointerDown={handleSettingsPointerDown}');
    // pointerdown only dismisses the tooltip; opening on pointerdown mounts the
    // dialog before mouseup and Base UI treats that as an outside-press (#378).
    expect(footerSource).toContain('setSettingsTooltipOpen(false)');
    expect(footerSource).not.toContain('activateTitlebarIconOnPointerDown');
    expect(footerSource).not.toContain('ignoreSettingsClickRef');
    expect(footerSource).not.toMatch(/activate:\s*\(\)\s*=>\s*\{[\s\S]*onOpenSettings/);
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
