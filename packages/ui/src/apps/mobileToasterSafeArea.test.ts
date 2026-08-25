import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import {
  MOBILE_TOASTER_CLASS,
  MOBILE_TOASTER_SAFE_AREA_OFFSET,
  mobileToasterOffsetCss,
  resolveMobileToasterInsetPx,
} from './mobileToasterSafeArea';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileAppSource = readFileSync(join(__dirname, 'MobileApp.tsx'), 'utf-8');
const mobileCss = readFileSync(join(__dirname, '../styles/mobile.css'), 'utf-8');
const mobileHtml = readFileSync(join(__dirname, '../../../web/mobile.html'), 'utf-8');
const desktopAppSource = readFileSync(join(__dirname, '../App.tsx'), 'utf-8');
const sonnerSource = readFileSync(join(__dirname, '../components/ui/sonner.tsx'), 'utf-8');

describe('mobile toaster safe area', () => {
  test('insets by env(safe-area-inset-*) and never hardcodes notch pixels', () => {
    expect(mobileToasterOffsetCss('top')).toContain('env(safe-area-inset-top, 0px)');
    expect(mobileToasterOffsetCss('bottom')).toContain('env(safe-area-inset-bottom, 0px)');
    expect(mobileToasterOffsetCss('top')).toContain('--oc-safe-area-top');
    expect(mobileToasterOffsetCss('bottom')).toContain('--oc-safe-area-bottom');
    expect(mobileToasterOffsetCss('top')).not.toMatch(/\b(44|47|59)px\b/);
    expect(mobileToasterOffsetCss('bottom')).not.toMatch(/\b(44|47|59)px\b/);
  });

  test('fixture: iPhone 390×844 with simulated safe-area-inset-top 47px', () => {
    // iPhone 14 CSS pixel size; 47px is a typical notch / status-bar inset.
    expect(resolveMobileToasterInsetPx(47)).toBe(63);
    expect(resolveMobileToasterInsetPx(0)).toBe(16);
  });

  test('MobileApp toaster uses the shared inset for offset and mobileOffset', () => {
    expect(mobileAppSource).toContain('MOBILE_TOASTER_CLASS');
    expect(mobileAppSource).toContain('MOBILE_TOASTER_SAFE_AREA_OFFSET');
    expect(mobileAppSource).toContain('mobileOffset={MOBILE_TOASTER_SAFE_AREA_OFFSET}');
    expect(mobileAppSource).toContain('offset={MOBILE_TOASTER_SAFE_AREA_OFFSET}');
    expect(mobileAppSource).toContain(`className={${'MOBILE_TOASTER_CLASS'}}`);
    expect(mobileAppSource).not.toContain('offset="calc(var(--oc-safe-area-top, 0px) + 16px)"');
  });

  test('hosted mobile.css insets the MobileApp toaster outside capacitor/standalone-only blocks', () => {
    const topRule = mobileCss.match(
      /\[data-sonner-toaster\]\.oc-mobile-toaster\[data-y-position='top'\]\s*\{([^}]+)\}/,
    )?.[1];
    const bottomRule = mobileCss.match(
      /\[data-sonner-toaster\]\.oc-mobile-toaster\[data-y-position='bottom'\]\s*\{([^}]+)\}/,
    )?.[1];

    expect(topRule).toBeDefined();
    expect(bottomRule).toBeDefined();
    expect(topRule).toContain(MOBILE_TOASTER_SAFE_AREA_OFFSET.top);
    expect(bottomRule).toContain(MOBILE_TOASTER_SAFE_AREA_OFFSET.bottom);

    const hostedTopIndex = mobileCss.indexOf(
      `[data-sonner-toaster].${MOBILE_TOASTER_CLASS}[data-y-position='top']`,
    );
    const standaloneBlock = mobileCss.indexOf('@media (display-mode: standalone)');
    expect(hostedTopIndex).toBeGreaterThan(-1);
    expect(hostedTopIndex).toBeLessThan(standaloneBlock);
  });

  test('mobile.html already requests edge-to-edge safe-area env() via viewport-fit=cover', () => {
    expect(mobileHtml).toContain('viewport-fit=cover');
  });

  test('desktop web toaster keeps the header offset and does not use the mobile inset', () => {
    expect(desktopAppSource).toContain('<Toaster position="top-center" />');
    expect(desktopAppSource).not.toContain(MOBILE_TOASTER_CLASS);
    expect(desktopAppSource).not.toContain('mobileOffset');
    expect(sonnerSource).toContain('offset={offset ?? "calc(var(--oc-header-height, 3rem) + 12px)"}');
    expect(sonnerSource).toContain('cn("toaster group app-region-no-drag", className)');
  });
});
