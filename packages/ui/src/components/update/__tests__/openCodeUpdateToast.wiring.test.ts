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

  test('header hosts the banner below the titlebar as a no-drag child', () => {
    expect(headerSource).toContain('OpenCodeUpdateBannerHost');
    expect(headerSource).toContain('<OpenCodeUpdateBannerHost />');
    expect(bannerSource).toContain('--oc-header-height');
    expect(bannerSource).toContain('app-region-no-drag');
    expect(bannerSource).not.toMatch(/absolute inset-x-0 top-0/);
    expect(bannerSource).not.toMatch(/fixed inset-x-0 top-3/);
  });
});
