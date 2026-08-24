import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tooltipSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'tooltip.tsx'),
  'utf8',
);

describe('tooltip click-through', () => {
  test('positioner and popup do not intercept pointer events', () => {
    expect(tooltipSource).toContain('className="pointer-events-none z-[200]"');
    expect(tooltipSource).toMatch(/oc-glass-tooltip pointer-events-none/);
  });
});
