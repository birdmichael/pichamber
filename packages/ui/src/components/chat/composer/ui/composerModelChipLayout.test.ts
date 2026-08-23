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

describe('Desktop composer model chip squeeze', () => {
  test('keeps a readable model-name floor on Desktop (not a single glyph)', () => {
    expect(indexCss).toMatch(
      /:root:not\(\.vscode-runtime\):not\(\.mobile-pointer\) \.model-controls__model-slot \{\s*min-width:\s*5\.5rem;/,
    );
    expect(indexCss).toMatch(
      /:root:not\(\.vscode-runtime\):not\(\.mobile-pointer\) \.model-controls__model-label \{\s*min-width:\s*5ch;/,
    );
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 14rem\)[\s\S]*?\.model-controls__model-icon \{\s*display:\s*none;/,
    );
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 14rem\)[\s\S]*?\.model-controls__model-slot \{\s*min-width:\s*3\.25rem;/,
    );
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
