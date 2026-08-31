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
const chatInputSource = readFileSync(
  join(__dirname, '../../ChatInput.tsx'),
  'utf-8',
);
const headerSource = readFileSync(
  join(__dirname, '../../../layout/Header.tsx'),
  'utf-8',
);
const shellSource = readFileSync(
  join(__dirname, '../state/useMobileComposerShell.ts'),
  'utf-8',
);
const pillSource = readFileSync(
  join(__dirname, 'MobilePillComposer.tsx'),
  'utf-8',
);
const buildRowSource = readFileSync(
  join(__dirname, '../../PiPlanBuildRow.tsx'),
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

  test('Desktop Plan chip toasts and mounts the Plan starts-when-you-send row', () => {
    expect(toggleSource).toContain('PLAN_MODE_ENABLED_NOTIFY');
    expect(toggleSource).toContain("decision.kind === 'draft-intent'");
    expect(toggleSource).toContain('presentPiExtensionUiNotify');
    expect(chatInputSource).toContain('<PiPlanStatusRow');
  });

  test('header title ⟳ is the reload glyph, hidden when idle', () => {
    expect(headerSource).toContain('isSessionTitleReloadGlyphVisible');
    expect(headerSource).toContain('showSessionTitleReloadGlyph');
    expect(headerSource).toContain('header.sessionReload.tooltip');
  });
});

describe('mobile Plan chip focus guard and pill Build', () => {
  test('Agent/Plan trigger holds the composer without preventDefault on the Radix trigger', () => {
    expect(toggleSource).not.toContain('event.preventDefault()');
    expect(toggleSource).not.toContain('onMouseDown={(event) => event.preventDefault()}');
    expect(toggleSource).not.toContain('onPointerDownCapture');
    expect(toggleSource).toContain('onPointerDown={() => onOpenChange?.(true)}');
    expect(toggleSource).toContain('<DropdownMenu onOpenChange={onOpenChange}>');
  });

  test('planMenuOpen holds the expanded composer while the Agent/Plan menu is open', () => {
    expect(shellSource).toContain('planMenuOpen');
    expect(chatInputSource).toContain('planMenuOpen: mobilePlanMenuOpen');
    expect(footerSource).toContain('onOpenChange={onPlanMenuOpenChange}');
  });

  test('collapsed pill mounts PiPlanBuildRow', () => {
    expect(pillSource).toContain('<PiPlanBuildRow');
  });

  test('PiPlanBuildRow Build still has preventDefault; model trigger does not', () => {
    const modelTrigger = buildRowSource.slice(
      buildRowSource.indexOf('<DropdownMenuTrigger'),
      buildRowSource.indexOf('</DropdownMenuTrigger>'),
    );
    expect(modelTrigger).not.toContain('event.preventDefault()');
    expect(modelTrigger).not.toContain('onMouseDown');
    expect(modelTrigger).not.toContain('onPointerDownCapture');

    const buildButton = buildRowSource.slice(
      buildRowSource.lastIndexOf('<Button'),
      buildRowSource.lastIndexOf('</Button>'),
    );
    expect(buildButton).toContain("t('chat.piPlan.build')");
    expect(buildButton).toContain('onMouseDown={(event) => event.preventDefault()}');
    expect(buildButton).toContain('onPointerDownCapture');
    expect(buildButton).toContain("event.pointerType === 'touch'");
  });
});
