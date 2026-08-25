import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  OpenCodeUpdateBanner,
  resolveUpdateAvailableBannerPortalTarget,
} from '../OpenCodeUpdateBanner';

describe('OpenCodeUpdateBanner', () => {
  test('portals to document.body, not a header-column host', () => {
    const body = { tagName: 'BODY' } as HTMLElement;
    const headerHost = { id: 'pichamber-update-available-host', tagName: 'DIV' } as HTMLElement;

    expect(resolveUpdateAvailableBannerPortalTarget({ body })).toBe(body);
    expect(resolveUpdateAvailableBannerPortalTarget({ body })).not.toBe(headerHost);
    expect(resolveUpdateAvailableBannerPortalTarget({ body: null })).toBeNull();
    expect(resolveUpdateAvailableBannerPortalTarget(null)).toBeNull();
  });

  test('sits below the titlebar, not over window chrome', () => {
    const markup = renderToStaticMarkup(
      <OpenCodeUpdateBanner
        title="Pi 0.84.3 available"
        dismissLabel="Dismiss"
        primaryLabel="OK"
        onDismiss={() => undefined}
        onPrimary={() => undefined}
      />,
    );

    expect(markup).toContain('data-update-available-host');
    expect(markup).toContain('data-update-available-banner');
    expect(markup).toContain('fixed');
    expect(markup).toContain('--oc-header-height');
    expect(markup).not.toContain('top-0');
    expect(markup).not.toContain('top-3');
    expect(markup).not.toContain('pt-1.5');
    expect(markup).not.toContain('absolute inset-x-0 top-0');
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
