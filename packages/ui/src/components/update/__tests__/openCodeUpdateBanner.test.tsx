import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { OpenCodeUpdateBanner } from '../OpenCodeUpdateBanner';

describe('OpenCodeUpdateBanner', () => {
  test('renders real Dismiss and OK buttons, not a sonner toast', () => {
    const markup = renderToStaticMarkup(
      <OpenCodeUpdateBanner
        title="Pi 0.84.3 available"
        dismissLabel="Dismiss"
        primaryLabel="OK"
        onDismiss={() => undefined}
        onPrimary={() => undefined}
      />,
    );

    expect(markup).toContain('data-update-available-banner');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('Dismiss');
    expect(markup).toContain('OK');
    expect(markup).toContain('Pi 0.84.3 available');
    expect(markup).toContain('app-region-no-drag');
    expect(markup).toContain('pointer-events-auto');
    expect(markup).not.toContain('data-sonner-toast');
    expect(markup).not.toContain('sonner');
  });
});
