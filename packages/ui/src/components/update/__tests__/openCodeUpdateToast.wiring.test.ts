import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

const toastSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../OpenCodeUpdateToast.tsx'),
  'utf-8',
);
const bannerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../OpenCodeUpdateBanner.tsx'),
  'utf-8',
);
const portalSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../openCodeUpdateBannerPortal.ts'),
  'utf-8',
);
const headerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../layout/Header.tsx'),
  'utf-8',
);

describe('Pi update available banner', () => {
  test('Pi kernel does not poll npm or render a Pi kernel banner', () => {
    expect(toastSource).toContain('if (isPiKernel) return');
    expect(toastSource).not.toContain('/api/pi/upgrade-status');
    expect(toastSource).not.toContain("t('piUpdate.toast.actions.ok')");
    expect(toastSource).toContain('/api/opencode/upgrade-status');
    expect(toastSource).toContain('<OpenCodeUpdateBanner');
    expect(toastSource).not.toMatch(/toast\.info\(/);
  });

  test('portals to document.body below the titlebar as a no-drag overlay', () => {
    expect(headerSource).not.toContain('OpenCodeUpdateBannerHost');
    expect(bannerSource).toContain('createPortal');
    expect(bannerSource).toContain('resolveUpdateAvailableBannerPortalTarget(document)');
    expect(portalSource).toContain('doc?.body ?? null');
    expect(bannerSource).toContain('--oc-header-height');
    expect(bannerSource).toContain('app-region-no-drag');
    expect(bannerSource).not.toMatch(/absolute inset-x-0 top-0/);
    expect(bannerSource).not.toMatch(/fixed inset-x-0 top-3/);
  });
});
