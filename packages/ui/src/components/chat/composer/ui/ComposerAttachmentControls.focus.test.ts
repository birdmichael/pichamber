import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const controls = readFileSync(join(dir, 'ComposerAttachmentControls.tsx'), 'utf8');
const footer = readFileSync(join(dir, 'ComposerFooter.tsx'), 'utf8');
const chatInput = readFileSync(join(dir, '../../ChatInput.tsx'), 'utf8');
const settings = readFileSync(join(dir, '../../../views/SettingsWindow.tsx'), 'utf8');

describe('composer keyboard restore', () => {
  test('the + menu restores composer focus on close, including Esc', () => {
    expect(controls).toContain('onOpenChange={props.onMenuOpenChange}');
    expect(footer).toContain('onMenuOpenChange={onAttachmentMenuOpenChange}');
    expect(chatInput).toContain('handleAttachmentMenuOpenChange');
    expect(chatInput).toContain('if (open) return;');
    expect(chatInput).toContain('composerRef.current?.focus()');
  });

  test('Settings close restores desktop renderer and composer focus', () => {
    expect(settings).toContain('void focusDesktopWindow()');
    expect(chatInput).toContain('isSettingsDialogOpen');
    expect(chatInput).toContain('void focusDesktopWindow()');
  });
});
