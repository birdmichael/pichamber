import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { OpenCodeUpdateBanner, OpenCodeUpdateBannerHost } from '../OpenCodeUpdateBanner';

describe('OpenCodeUpdateBanner', () => {
  test('host and fallback sit below the titlebar, not over window chrome', () => {
    const hostMarkup = renderToStaticMarkup(<OpenCodeUpdateBannerHost />);
    const fallbackMarkup = renderToStaticMarkup(
      <OpenCodeUpdateBanner
        title="Pi 0.84.3 available"
        dismissLabel="Dismiss"
        primaryLabel="OK"
        onDismiss={() => undefined}
        onPrimary={() => undefined}
      />,
    );

    expect(hostMarkup).toContain('data-update-available-host');
    expect(hostMarkup).toContain('fixed');
    expect(hostMarkup).toContain('--oc-header-height');
    expect(hostMarkup).not.toContain('top-0');
    expect(hostMarkup).not.toContain('pt-1.5');

    expect(fallbackMarkup).toContain('data-update-available-banner');
    expect(fallbackMarkup).toContain('--oc-header-height');
    expect(fallbackMarkup).not.toContain('top-0');
    expect(fallbackMarkup).not.toContain('top-3');
  });

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
