import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const visualSettingsSource = readFileSync(join(here, 'OpenChamberVisualSettings.tsx'), 'utf-8');
const selectSource = readFileSync(join(here, '../../ui/select.tsx'), 'utf-8');

describe('Appearance language select', () => {
  test('keeps the menu below the trigger instead of flipping over Window controls', () => {
    expect(visualSettingsSource).toContain('settingsItem="appearance.language"');
    expect(visualSettingsSource).toContain('SELECT_PREFER_BELOW_COLLISION');
    expect(visualSettingsSource).toMatch(/SelectContent[\s\S]*?side="bottom"[\s\S]*?portalToBody[\s\S]*?collisionAvoidance=\{SELECT_PREFER_BELOW_COLLISION\}/);
    expect(selectSource).toContain('collisionAvoidance={collisionAvoidance}');
    expect(selectSource).toContain('side: "shift"');
    expect(selectSource).toContain('fallbackAxisSide: "none"');
  });
});
