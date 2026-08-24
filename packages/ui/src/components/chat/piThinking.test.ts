import { describe, expect, test } from 'bun:test';
import {
  clampPiThinkingLevel,
  parseAvailablePiThinkingLevels,
  parsePiThinkingLevel,
  resolvePiThinkingChipPresentation,
  resolveVisiblePiThinkingLevels,
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
    expect(parsePiThinkingLevel(undefined)).toBe(undefined);
    expect(parsePiThinkingLevel(null)).toBe(undefined);
    expect(parsePiThinkingLevel('')).toBe(undefined);
    expect(parsePiThinkingLevel('   ')).toBe(undefined);
    expect(parsePiThinkingLevel('HIGH')).toBe(undefined);
    expect(parsePiThinkingLevel('unknown')).toBe(undefined);
    expect(parsePiThinkingLevel(4)).toBe(undefined);
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
    expect(resolvePiThinkingChipPresentation('xhigh')).toEqual({
      status: 'ready',
      level: 'xhigh',
      label: 'xhigh',
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
    expect(pending).toEqual({ status: 'pending' });
    expect(pending).not.toEqual({ status: 'ready', level: 'high', label: 'High' });
  });
});

describe('available Pi thinking levels', () => {
  test('keeps live session order and drops unknown tokens', () => {
    expect(parseAvailablePiThinkingLevels(['low', 'medium', 'high', 'max', 'max', 'nope'])).toEqual([
      'low', 'medium', 'high', 'max',
    ]);
    expect(parseAvailablePiThinkingLevels(undefined)).toEqual([]);
    expect(parseAvailablePiThinkingLevels(['HIGH'])).toEqual([]);
  });

  test('falls back to the full Pi list until the session answers', () => {
    expect(resolveVisiblePiThinkingLevels(undefined)).toEqual([
      'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
    ]);
    expect(resolveVisiblePiThinkingLevels(['low', 'high'])).toEqual(['low', 'high']);
  });

  test('clamps a saved default onto the live available list', () => {
    expect(clampPiThinkingLevel('max', ['low', 'medium', 'high'])).toBe('medium');
    expect(clampPiThinkingLevel('high', ['low', 'high'])).toBe('high');
    expect(clampPiThinkingLevel('off', ['low', 'high'])).toBe('low');
    expect(clampPiThinkingLevel(undefined, undefined)).toBe('medium');
  });
});
