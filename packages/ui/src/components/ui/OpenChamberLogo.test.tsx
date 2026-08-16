import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { I18nProvider } from '@/lib/i18n';
import { OpenChamberLogo, PichamberLogo } from './OpenChamberLogo';
import {
  PICHAMBER_CUBE_PATHS,
  PICHAMBER_INNER_GLYPH_PATHS,
  PICHAMBER_INNER_GLYPH_TRANSFORM,
  PICHAMBER_MARK_VIEWBOX,
} from './pichamber-mark';

const renderLogo = (props = {}) => renderToStaticMarkup(
  <I18nProvider>
    <OpenChamberLogo {...props} />
  </I18nProvider>,
);

describe('OpenChamberLogo', () => {
  test('renders the chamber with the Pi glyph in the old OpenCode O slot', () => {
    const markup = renderLogo({ width: 64, height: 64 });

    expect(markup).toContain(`viewBox="${PICHAMBER_MARK_VIEWBOX}"`);
    expect(markup).toContain('aria-label="Pichamber logo"');
    expect(markup).toContain(`transform="${PICHAMBER_INNER_GLYPH_TRANSFORM}"`);
    expect(markup).toContain('scale(0.068)');
    expect(markup).not.toContain('OpenCode');
    expect(markup).not.toContain('scale(0.115)');
    expect(markup).not.toContain('matrix(0.866, 0.5, -0.866, 0.5, 50, 56)');
    for (const path of PICHAMBER_CUBE_PATHS) {
      expect(markup).toContain(path.d);
    }
    for (const path of PICHAMBER_INNER_GLYPH_PATHS) {
      expect(markup).toContain(path.d);
    }
  });

  test('keeps PichamberLogo as an alias for existing OpenChamberLogo callers', () => {
    expect(PichamberLogo).toBe(OpenChamberLogo);
  });

  test('animates the inner glyph when requested', () => {
    const markup = renderLogo({ isAnimated: true });
    expect(markup).toContain('oc-logo-glow');
    expect(renderLogo()).not.toContain('oc-logo-glow');
  });
});
