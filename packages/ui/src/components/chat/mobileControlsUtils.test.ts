import { describe, expect, test } from 'bun:test';

import { shouldShowComposerAgentChip } from './composerAgentChip';
import { isPrimaryMode } from './mobileControlsUtils';

/** Same composition as MobileAgentButton after getVisibleAgents(). */
const shouldShowMobileAgentButton = (
  agents: ReadonlyArray<{ name: string; mode?: string }>,
) => shouldShowComposerAgentChip(agents.filter((agent) => isPrimaryMode(agent.mode)));

describe('MobileAgentButton Pi hide', () => {
  test('mobile/Pi does not render the dummy Pi agent chip', () => {
    expect(shouldShowMobileAgentButton([{ name: 'pi' }])).toBe(false);
    expect(shouldShowMobileAgentButton([{ name: 'pi', mode: 'primary' }])).toBe(false);
  });

  test('keeps a real OpenCode or extra Pi agent chip', () => {
    expect(shouldShowMobileAgentButton([{ name: 'build' }])).toBe(true);
    expect(shouldShowMobileAgentButton([
      { name: 'build' },
      { name: 'plan' },
    ])).toBe(true);
    expect(shouldShowMobileAgentButton([
      { name: 'pi' },
      { name: 'reviewer' },
    ])).toBe(true);
  });

  test('ignores non-primary leftover agents when deciding the dummy Pi chip', () => {
    expect(shouldShowMobileAgentButton([
      { name: 'pi', mode: 'primary' },
      { name: 'reviewer', mode: 'subagent' },
    ])).toBe(false);
  });

  test('does not hide an empty list so OpenCode can still paint while agents hydrate', () => {
    expect(shouldShowMobileAgentButton([])).toBe(true);
  });
});
