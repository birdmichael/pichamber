import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexCss = readFileSync(join(__dirname, '../../../../index.css'), 'utf-8');
const modelControlsSource = readFileSync(
  join(__dirname, '../../ModelControls.tsx'),
  'utf-8',
);
const composerFooterSource = readFileSync(
  join(__dirname, './ComposerFooter.tsx'),
  'utf-8',
);

describe('Desktop composer model chip squeeze', () => {
  test('keeps a readable model-name floor on Desktop (not a single glyph)', () => {
    expect(indexCss).toMatch(
      /html:not\(\.vscode-runtime\):not\(\.mobile-pointer\) \.model-controls__model-slot \{\s*min-width:\s*5\.5rem;/,
    );
    expect(indexCss).toMatch(
      /html:not\(\.vscode-runtime\):not\(\.mobile-pointer\) \.model-controls__model-label \{\s*min-width:\s*5ch;/,
    );
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 14rem\)[\s\S]*?\.model-controls__model-icon \{\s*display:\s*none;/,
    );
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 14rem\)[\s\S]*?\.model-controls__model-slot \{\s*min-width:\s*3\.25rem;/,
    );
  });

  test('ellipsizes the model label instead of clipping mid-glyph', () => {
    expect(indexCss).toMatch(
      /html:not\(\.vscode-runtime\):not\(\.mobile-pointer\) \.model-controls__model-label > \.marquee-text \{[\s\S]*?text-overflow:\s*ellipsis;/,
    );
    expect(indexCss).not.toMatch(
      /@container model-controls \([^)]+\) \{\s*:root/,
    );
  });

  test('hides the entire Agent chip through a ~500px child footer', () => {
    // Label-only hide is not enough: at the live parent/child squeeze the
    // leftover chip still paints `A` plus a sliver or `Agen`. Hide the slot.
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 22rem\)[\s\S]*?\.model-controls__agent-label \{\s*display:\s*none;/,
    );

    const slotHide = indexCss.match(
      /@container model-controls \(max-width: ([\d.]+)rem\) \{[\s\S]*?\.model-controls__agent-slot/,
    );
    expect(slotHide).toBeTruthy();
    const hideRem = Number(slotHide![1]);
    const hidePx = hideRem * 16;
    // Child footer at intermediate width is ~500px (sidebar 280 + parent
    // ~475). 27rem / 432px still painted `Ager`. Hide through 36rem /
    // 576px so any footer that cannot fit model + thinking + full Agent
    // + send drops Agent. Wide parent B (~1000px) stays above that.
    expect(hideRem).toBeGreaterThanOrEqual(36);
    expect(hidePx).toBeGreaterThanOrEqual(576);
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 36rem\)\s*\{[\s\S]*?\.model-controls__agent-slot[\s\S]*?display:\s*none;/,
    );
    expect(indexCss).toMatch(
      /html:not\(\.vscode-runtime\):not\(\.mobile-pointer\) \.model-controls__agent-slot \{[\s\S]*?overflow:\s*hidden;/,
    );

    expect(modelControlsSource).toContain('model-controls__agent-slot');
    expect(modelControlsSource).toContain('model-controls__agent-trigger');
    expect(modelControlsSource).toMatch(/model-controls__agent-slot[^"]*overflow-hidden/);
  });

  test('hides the whole thinking chip at the 22rem squeeze so the icon cannot sit on neighbors', () => {
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 22rem\)[\s\S]*?\.model-controls__variant-label[\s\S]*?display:\s*none;/,
    );
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 22rem\)[\s\S]*?\.model-controls__variant-slot[\s\S]*?display:\s*none;/,
    );
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 22rem\)[\s\S]*?\.model-controls__variant-trigger[\s\S]*?display:\s*none;/,
    );
    expect(modelControlsSource).toContain('model-controls__variant-label');
    expect(modelControlsSource).toContain('model-controls__variant-trigger');
    expect(modelControlsSource).toContain('brain-ai-3');
  });

  test('parent footer chip row keeps a real gap, shrink-0 thinking, and no negative margin', () => {
    expect(indexCss).toMatch(
      /html:not\(\.vscode-runtime\):not\(\.mobile-pointer\) \.model-controls__row \{[\s\S]*?column-gap:\s*0\.75rem;[\s\S]*?margin:\s*0;/,
    );
    expect(indexCss).toMatch(
      /html:not\(\.vscode-runtime\):not\(\.mobile-pointer\) \.model-controls__variant-slot[\s\S]*?flex-shrink:\s*0;[\s\S]*?margin:\s*0;/,
    );
    expect(indexCss).not.toMatch(
      /\.model-controls__row[\s\S]{0,80}column-gap:\s*0\.375rem/,
    );
    expect(indexCss).not.toMatch(
      /\.model-controls__(?:row|variant-slot|variant-trigger)[\s\S]{0,120}margin-(?:left|inline-start):\s*-/,
    );
    expect(composerFooterSource).toContain('data-composer-chip-row="true"');
    expect(composerFooterSource).toMatch(/data-composer-chip-row="true"[\s\S]*?gap-x-2[\s\S]*?m-0/);
    expect(modelControlsSource).toMatch(/model-controls__variant-slot[^"]*shrink-0[^"]*m-0/);
    expect(modelControlsSource).not.toMatch(/model-controls__(?:row|variant-slot)[^"]*-m[lxy]?-/);
  });

  test('parent composer footer is the model-controls query container', () => {
    // The hide rules query @container model-controls. That name must live
    // on THIS composer footer so a ~328px parent column hides Agent. If the
    // named container is html (or another wide ancestor), the parent sees
    // ~1280px and never hides — the child pane already had a real ~315px
    // container, which is why only the parent showed a clipped A sliver.
    expect(composerFooterSource).toContain('@container/model-controls');
    expect(composerFooterSource).toContain('data-chat-input-footer="true"');
    expect(indexCss).toMatch(
      /div\[data-chat-input-footer="true"\][\s\S]*?\[data-composer-chip-row="true"\][\s\S]*?container-type:\s*inline-size;[\s\S]*?container-name:\s*model-controls;/,
    );
    // ModelControls must not steal the name (nearest ancestor wins).
    expect(modelControlsSource).not.toContain('@container/model-controls');
  });

  test('keeps the send control outside the shrinking chip row', () => {
    expect(composerFooterSource).toContain('data-composer-send="true"');
    expect(composerFooterSource).toMatch(/data-composer-send="true"[\s\S]*?shrink-0/);
  });

  test('marks the Desktop model glyph so Walkthrough can hide it without dropping the name', () => {
    expect(modelControlsSource).toContain('model-controls__model-icon');
    expect(modelControlsSource).toContain('model-controls__plan-slot');
    expect(modelControlsSource).not.toMatch(/model-controls__model-slot min-w-0/);
  });

  test('does not hardcode a provider or move the model chip into slash', () => {
    expect(modelControlsSource).not.toMatch(/['"]Grok/);
    expect(indexCss).not.toMatch(/Grok/);
    expect(modelControlsSource).not.toMatch(/setActiveMobilePanel\('slash'\)/);
  });
});
