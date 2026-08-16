import { describe, expect, test } from 'bun:test';
import { resolvePiDefaultAgentSelection } from './piAgentSelection';

describe('resolvePiDefaultAgentSelection', () => {
  test('selects the built-in pi agent when present', () => {
    expect(resolvePiDefaultAgentSelection([
      { name: 'build' },
      { name: 'pi' },
    ])).toBe('pi');
  });

  test('does not invent a selection when pi is absent', () => {
    expect(resolvePiDefaultAgentSelection([{ name: 'build' }])).toBeNull();
    expect(resolvePiDefaultAgentSelection([])).toBeNull();
  });
});
