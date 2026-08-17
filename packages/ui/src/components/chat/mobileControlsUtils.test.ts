import { describe, expect, test } from 'bun:test';

import { shouldShowMobileComposerAgentChip } from './mobileControlsUtils';

describe('shouldShowMobileComposerAgentChip', () => {
  test('mobile/Pi does not render the dummy Pi agent chip', () => {
    expect(shouldShowMobileComposerAgentChip([{ name: 'pi' }])).toBe(false);
    expect(shouldShowMobileComposerAgentChip([{ name: 'pi', mode: 'primary' }])).toBe(false);
  });

  test('keeps a real OpenCode or extra Pi agent chip', () => {
    expect(shouldShowMobileComposerAgentChip([{ name: 'build' }])).toBe(true);
    expect(shouldShowMobileComposerAgentChip([
      { name: 'build' },
      { name: 'plan' },
    ])).toBe(true);
    expect(shouldShowMobileComposerAgentChip([
      { name: 'pi' },
      { name: 'reviewer' },
    ])).toBe(true);
  });

  test('ignores non-primary leftover agents when deciding the dummy Pi chip', () => {
    expect(shouldShowMobileComposerAgentChip([
      { name: 'pi', mode: 'primary' },
      { name: 'reviewer', mode: 'subagent' },
    ])).toBe(false);
  });

  test('does not hide an empty list so OpenCode can still paint while agents hydrate', () => {
    expect(shouldShowMobileComposerAgentChip([])).toBe(true);
  });
});
