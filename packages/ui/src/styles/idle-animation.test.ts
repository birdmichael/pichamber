import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const designSystemCss = readFileSync(new URL('./design-system.css', import.meta.url), 'utf8');
const logoSource = readFileSync(new URL('../components/ui/OpenChamberLogo.tsx', import.meta.url), 'utf8');

const sliceBetween = (source: string, start: string, end: string): string => {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt).toBeGreaterThan(-1);
  expect(endAt).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
};

describe('idle chrome animations', () => {
  test('optional logo pulse animates opacity/transform only', () => {
    const block = sliceBetween(logoSource, '@keyframes oc-logo-glow', '@media');
    expect(block).toContain('opacity');
    expect(block).toContain('transform');
    expect(block).not.toMatch(/\bfilter\b/);
    expect(block).not.toContain('drop-shadow');
    expect(block).not.toContain('border-color');
  });

  test('border-glow-pulse does not animate filter or border-color', () => {
    const keyframes = sliceBetween(indexCss, '@keyframes border-glow-pulse', '.animate-border-glow-pulse');
    const rule = sliceBetween(indexCss, '.animate-border-glow-pulse {', '}\n');
    expect(keyframes).toContain('opacity');
    expect(keyframes).not.toContain('border-color');
    expect(keyframes).not.toMatch(/\bfilter\b/);
    expect(rule).not.toContain('border-color');
    expect(rule).not.toMatch(/\bfilter\b/);
  });

  test('hidden documents can pause glass backdrop-filter without changing the focused rule', () => {
    expect(designSystemCss).toContain('html.oc-pause-expensive-paint .oc-glass-panel');
    expect(designSystemCss).toContain('backdrop-filter: blur(var(--oc-glass-blur))');
  });
});
