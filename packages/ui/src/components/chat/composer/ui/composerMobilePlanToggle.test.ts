import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileCss = readFileSync(
  join(__dirname, '../../../../styles/mobile.css'),
  'utf-8',
);
const footerSource = readFileSync(join(__dirname, 'ComposerFooter.tsx'), 'utf-8');
const toggleSource = readFileSync(
  join(__dirname, '../../PiPlanModeToggle.tsx'),
  'utf-8',
);
const modelControlsSource = readFileSync(
  join(__dirname, '../../ModelControls.tsx'),
  'utf-8',
);

const ICON_SLOT_WIDTH = /width:\s*1\.5rem\s*!important/;

function cssRulesMatching(selectorPattern: RegExp): string[] {
  return [...mobileCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter((match) => selectorPattern.test(match[1] ?? ''))
    .map((match) => match[0]);
}

describe('mobile composer Agent/Plan chip width', () => {
  test('does not clamp every button in the mobile action cluster to the 24px icon slot', () => {
    const unscopedClamps = cssRulesMatching(/\.composer-mobile-actions\s+button(?!\s*:not)/)
      .filter((rule) => ICON_SLOT_WIDTH.test(rule));

    expect(unscopedClamps).toEqual([]);
    expect(mobileCss).toMatch(
      /\.composer-mobile-actions\s+button:not\(\.pi-plan-mode-toggle\)\s*\{[^}]*width:\s*1\.5rem\s*!important/,
    );
    expect(mobileCss).toMatch(
      /\.composer-mobile-actions\s+\.pi-plan-mode-toggle\s*\{[^}]*width:\s*auto\s*!important/,
    );
  });

  test('the Agent/Plan trigger opts out of the icon-slot clamp and keeps a visible label', () => {
    expect(toggleSource).toContain("'pi-plan-mode-toggle normal-case'");
    expect(footerSource).toContain('composer-mobile-actions');
    expect(footerSource).toContain('<PiPlanModeToggle');
    expect(modelControlsSource).toContain('<PiPlanModeToggle');
    expect(modelControlsSource).not.toContain('composer-mobile-actions');
  });
});
