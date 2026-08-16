import { describe, expect, test } from 'bun:test';
import {
  parsePiThinkingLevel,
  resolvePiThinkingChipPresentation,
} from './piThinking';

describe('parsePiThinkingLevel', () => {
  test('accepts every saved Pi thinking level', () => {
    expect(parsePiThinkingLevel('off')).toBe('off');
    expect(parsePiThinkingLevel('minimal')).toBe('minimal');
    expect(parsePiThinkingLevel('low')).toBe('low');
    expect(parsePiThinkingLevel('medium')).toBe('medium');
    expect(parsePiThinkingLevel('high')).toBe('high');
    expect(parsePiThinkingLevel('xhigh')).toBe('xhigh');
    expect(parsePiThinkingLevel('max')).toBe('max');
  });

  test('trims whitespace from a valid level', () => {
    expect(parsePiThinkingLevel('  max  ')).toBe('max');
  });

  test('does not invent high when the payload is missing or invalid', () => {
    expect(parsePiThinkingLevel(undefined)).toBeUndefined();
    expect(parsePiThinkingLevel(null)).toBeUndefined();
    expect(parsePiThinkingLevel('')).toBeUndefined();
    expect(parsePiThinkingLevel('   ')).toBeUndefined();
    expect(parsePiThinkingLevel('HIGH')).toBeUndefined();
    expect(parsePiThinkingLevel('unknown')).toBeUndefined();
    expect(parsePiThinkingLevel(4)).toBeUndefined();
  });
});

describe('resolvePiThinkingChipPresentation', () => {
  test('first paint stays pending instead of flashing High', () => {
    expect(resolvePiThinkingChipPresentation(undefined)).toEqual({ status: 'pending' });
    expect(resolvePiThinkingChipPresentation('')).toEqual({ status: 'pending' });
  });

  test('renders the saved default once it is known', () => {
    expect(resolvePiThinkingChipPresentation('max')).toEqual({
      status: 'ready',
      level: 'max',
      label: 'Max',
    });
    expect(resolvePiThinkingChipPresentation('low')).toEqual({
      status: 'ready',
      level: 'low',
      label: 'Low',
    });
    expect(resolvePiThinkingChipPresentation('off')).toEqual({
      status: 'ready',
      level: 'off',
      label: 'Off',
    });
  });

  test('does not treat high as the implicit product default', () => {
    const pending = resolvePiThinkingChipPresentation(undefined);
    expect(pending).not.toMatchObject({ level: 'high' });
    expect(pending).not.toMatchObject({ label: 'High' });
  });
});
