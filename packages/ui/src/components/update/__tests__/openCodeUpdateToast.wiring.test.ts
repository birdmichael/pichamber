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
  test('available update is React state, not a sonner Infinity toast', () => {
    expect(toastSource).toContain('const [availableVersion, setAvailableVersion]');
    expect(toastSource).toContain('setAvailableVersion(version)');
    expect(toastSource).toContain('<OpenCodeUpdateBanner');
    expect(toastSource).toContain("t('piUpdate.toast.actions.dismiss')");
    expect(toastSource).toContain("t('piUpdate.toast.actions.ok')");
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
