import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'SettingsReveal.tsx'),
  'utf-8',
);

describe('SettingsReveal', () => {
  test('consumes the first pointer on the revealed subtree instead of a short ignore window', () => {
    expect(source).toContain('shouldConsumeSettingsRevealEvent');
    expect(source).toContain("addEventListener('pointerdown'");
    expect(source).toContain("addEventListener('pointerup'");
    expect(source).toContain("addEventListener('click'");
    expect(source).not.toContain('pointerEvents');
    expect(source).not.toContain('SETTINGS_REVEAL_GUARD_MS');
  });
});
