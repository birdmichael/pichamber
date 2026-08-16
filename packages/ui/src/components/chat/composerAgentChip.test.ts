import { describe, expect, test } from 'bun:test';
import { shouldShowComposerAgentChip } from './composerAgentChip';

describe('shouldShowComposerAgentChip', () => {
  test('hides the chip when the only selectable agent is the synthetic pi default', () => {
    expect(shouldShowComposerAgentChip([{ name: 'pi' }])).toBe(false);
  });

  test('keeps OpenCode build, plan, and custom agents visible', () => {
    expect(shouldShowComposerAgentChip([{ name: 'build' }])).toBe(true);
    expect(shouldShowComposerAgentChip([
      { name: 'build' },
      { name: 'plan' },
    ])).toBe(true);
    expect(shouldShowComposerAgentChip([
      { name: 'build' },
      { name: 'reviewer' },
    ])).toBe(true);
  });

  test('shows the chip when Pi later has a user-selectable agent besides the synthetic default', () => {
    expect(shouldShowComposerAgentChip([
      { name: 'pi' },
      { name: 'reviewer' },
    ])).toBe(true);
    expect(shouldShowComposerAgentChip([{ name: 'reviewer' }])).toBe(true);
  });

  test('does not hide an empty list so OpenCode can still paint while agents hydrate', () => {
    expect(shouldShowComposerAgentChip([])).toBe(true);
  });
});
