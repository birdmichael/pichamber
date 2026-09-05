import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'WorkStatusUsageSection.tsx'),
  'utf-8',
);

const body = source.slice(
  source.indexOf('const UsageSectionBody'),
  source.indexOf('export const WorkStatusUsageSection'),
);

describe('UsageSectionBody provider status', () => {
  test('keeps the provider logo and name on their own row', () => {
    expect(body).toContain('ProviderLogo');
    expect(body).toContain('label={group.providerName}');
    expect(body).toContain('value={group.badge}');
  });

  test('renders long status as wrapping body text, not as a trailing nowrap value', () => {
    // WorkStatusRow value is shrink-0 on an h-7 row; a SuperGrok / X Premium
    // sentence in that slot is cut mid-word at 390px.
    expect(body).not.toMatch(/value=\{group\.status/);
    expect(body).toContain('whitespace-normal');
    expect(body).toContain('break-words');
    expect(body).toContain('text-wrap');
    expect(body).toContain('{group.status}');
  });

  test('omits the status body when the provider has no status', () => {
    expect(body).toContain('{group.status ? (');
    expect(body).toContain(') : null}');
  });

  test('renders window rows with OpenChamber UsageProgressBar chrome', () => {
    expect(body).toContain('UsageProgressBar');
    expect(body).toContain('percent={displayPercent}');
    expect(body).toContain('tonePercent={row.window.usedPercent}');
    expect(body).toContain('className="h-1.5"');
    expect(body).toContain('tabular-nums');
    expect(body).not.toContain('flex items-baseline justify-between');
  });
});

describe('Pi usage groups', () => {
  test('keeps xAI then Kimi Code order and fetches only active slots', () => {
    expect(source).toContain("useFeaturePluginSlotActive('xai'");
    expect(source).toContain("useFeaturePluginSlotActive('kimi'");
    expect(source).toContain("providerName: payload?.providerName || 'xAI'");
    expect(source).toContain("providerName: payload?.providerName || 'Kimi Code'");
    expect(source).toContain('fetchXaiUsage(id)');
    expect(source).toContain('fetchKimiUsage(id)');
    expect(source.indexOf("...(xaiSlotActive ? xaiGroups : [])")).toBeLessThan(
      source.indexOf("...(kimiSlotActive ? kimiGroups : [])"),
    );
  });

  test('kimi groups set badge from membership and xAI omits it', () => {
    const xaiBlock = source.slice(
      source.indexOf('const useXaiUsageGroups'),
      source.indexOf('const useKimiUsageGroups'),
    );
    const kimiBlock = source.slice(
      source.indexOf('const useKimiUsageGroups'),
      source.indexOf('const PiUsageSection'),
    );
    expect(kimiBlock).toContain('badge: formatKimiMembershipLabel(payload?.membershipLevel, t)');
    expect(kimiBlock).toContain('formatKimiWindowLabel(label, t)');
    expect(kimiBlock).not.toContain('formatWindowLabel(label)');
    expect(xaiBlock).toContain('formatWindowLabel(label)');
    expect(xaiBlock).not.toContain('badge:');
  });

  test('kimi weekly and 5h metrics use percent without valueLabel', () => {
    expect(body).toContain('isKimiSubscriptionId(group.providerId) ? undefined');
  });
});

