import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCycledPrimaryAgentName } from '../mobileControlsUtils';

const chatInputSource = readFileSync(
  resolve(import.meta.dir, '../ChatInput.tsx'),
  'utf8',
);

describe('cycle-agent-tab-noop (#687)', () => {
  test('getCycledPrimaryAgentName returns null for a single primary agent', () => {
    const agents = [{ name: 'pi', mode: 'primary' as const }];
    expect(getCycledPrimaryAgentName(agents as never, 'pi', 1)).toBeNull();
    expect(getCycledPrimaryAgentName(agents as never, 'pi', -1)).toBeNull();
  });

  test('ChatInput inserts a tab when cycle_agent cannot change the agent', () => {
    expect(chatInputSource).toContain("insertTextAtSelection('\\t')");
    expect(chatInputSource).toContain('getCycledPrimaryAgentName(agents, currentAgentName, cycleAgentDirection)');
    // Must not unconditionally preventDefault before checking whether a cycle exists.
    expect(chatInputSource).toMatch(
      /cycleAgentDirection !== 0 && openAutocomplete === null\) \{\s*\/\/ When cycling is a no-op/,
    );
  });
});
