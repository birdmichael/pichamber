import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ProviderKimiUsage.tsx'),
  'utf-8',
);

describe('ProviderKimiUsage quota chrome', () => {
  test('keeps membership as the title accessory', () => {
    expect(source).toContain('titleAccessory={membershipLabel ? (');
    expect(source).toContain('formatKimiMembershipLabel(payload?.membershipLevel, t)');
  });

  test('weekly window uses Weekly without Limit', () => {
    expect(source).toContain('formatKimiWindowLabel(label, t)');
    expect(source).not.toContain('formatWindowLabel(label)');
  });

  test('renders Header-style window rows with UsageProgressBar', () => {
    expect(source).toContain('UsageProgressBar');
    expect(source).toContain('percent={window.usedPercent}');
    expect(source).toContain('tonePercent={window.usedPercent}');
    expect(source).toContain('className="h-1.5"');
    expect(source).toContain('tabular-nums');
    expect(source).toContain("formatQuotaValueLabel(undefined, window.usedPercent)");
    expect(source).not.toContain('flex items-baseline justify-between');
    expect(source).not.toContain('Resets ');
  });

  test('leaves loading, error, and expires copy unchanged', () => {
    expect(source).toContain("settings.providers.page.kimiUsage.loading");
    expect(source).toContain("settings.providers.page.kimiUsage.notConfigured");
    expect(source).toContain("settings.providers.page.kimiUsage.expires");
  });
});
