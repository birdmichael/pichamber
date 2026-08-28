import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'WorkStatusPrimitives.tsx'),
  'utf-8',
);

describe('WorkStatusSection heading', () => {
  test('keeps the section summary next to the title instead of flush right', () => {
    const heading = source.slice(
      source.indexOf('export const WorkStatusSection'),
      source.indexOf('export const WorkStatusCollapsibleSection'),
    );
    expect(heading).toContain("HEADING_CLASS, 'shrink-0'");
    expect(heading).toContain('pr-6');
    expect(heading).not.toContain('flex-1 truncate');
  });
});
