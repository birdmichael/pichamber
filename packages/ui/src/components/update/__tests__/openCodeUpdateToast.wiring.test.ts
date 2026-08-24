import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

const toastSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../OpenCodeUpdateToast.tsx'),
  'utf-8',
);
const toasterSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../ui/sonner.tsx'),
  'utf-8',
);

describe('Pi update toast click wiring', () => {
  test('Dismiss and OK both call dismiss, and toast.info is not left with a no-op action', () => {
    expect(toastSource).toContain("label: tRef.current('piUpdate.toast.actions.ok')");
    expect(toastSource).toContain("label: tRef.current('piUpdate.toast.actions.dismiss')");
    expect(toastSource).toMatch(/action:\s*\{[\s\S]*onClick: dismiss/);
    expect(toastSource).toMatch(/cancel:\s*\{[\s\S]*onClick: dismiss/);
  });

  test('pins Electron no-drag on the toaster so header drag cannot swallow Dismiss', () => {
    expect(toasterSource).toContain('app-region-no-drag');
    expect(toasterSource).toContain('-webkit-app-region');
    expect(toasterSource).toContain('no-drag');
    expect(toasterSource).toContain('[data-sonner-toaster]');
  });
});
