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
});
