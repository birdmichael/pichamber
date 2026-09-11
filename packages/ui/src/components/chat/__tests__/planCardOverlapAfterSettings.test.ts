import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

const chatContainerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../ChatContainer.tsx'),
  'utf-8',
);

describe('plan-card-overlap-after-settings', () => {
  test('MessageList receives measured composer overlay height (not hard 0)', () => {
    expect(chatContainerSource).toContain('composerOverlayHeight={composerOverlayHeight}');
    expect(chatContainerSource).toContain(
      'composerOverlayHeight={statusOverlayHeight > 0 ? composerOverlayHeight : 0}',
    );
    expect(chatContainerSource).not.toMatch(/composerOverlayHeight=\{0\}/);
  });

  test('status overlay measure includes StatusRow margin and reflows after Settings', () => {
    expect(chatContainerSource).toContain('getComputedStyle(child).marginBottom');
    expect(chatContainerSource).toContain('isSettingsDialogOpen');
    expect(chatContainerSource).toContain('wasSettingsOpenRef');
    expect(chatContainerSource).toContain('statusOverlayHeight');
  });
});
