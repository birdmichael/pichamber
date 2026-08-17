import { describe, expect, test } from 'bun:test';

import { getToolMetadata, resolveToolDisplayName } from './toolHelpers';

describe('Pichamber Web tool chrome', () => {
  test('pichamber_web is Pichamber Web JSON chrome', () => {
    const metadata = getToolMetadata('pichamber_web');
    expect(metadata.displayName).toBe('Pichamber Web');
    expect(metadata.category).toBe('system');
    expect(metadata.outputLanguage).toBe('json');
    expect(resolveToolDisplayName('pichamber_web')).toBe('Pichamber Web');
  });

  test('keeps leftover openchamber_web for the OpenCode plugin', () => {
    expect(getToolMetadata('openchamber_web').displayName).toBe('Pichamber Web');
    expect(resolveToolDisplayName('openchamber_web')).toBe('Pichamber Web');
  });

  test('a leftover nameless tool part is the empty Tool row, not Pichamber Web', () => {
    expect(resolveToolDisplayName('tool')).toBe('Tool');
    expect(resolveToolDisplayName('tool')).not.toBe('Pichamber Web');
  });
});
