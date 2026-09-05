import { describe, expect, test } from 'bun:test';

import { shouldCollapseExpandedInputOnEscape } from './expandedInputEscape';

describe('shouldCollapseExpandedInputOnEscape', () => {
  test('collapses desktop focus mode on Escape', () => {
    expect(shouldCollapseExpandedInputOnEscape({
      key: 'Escape',
      isExpandedInput: true,
      isMobile: false,
    })).toBe(true);
  });

  test('ignores non-Escape keys and mobile', () => {
    expect(shouldCollapseExpandedInputOnEscape({
      key: 'Enter',
      isExpandedInput: true,
    })).toBe(false);
    expect(shouldCollapseExpandedInputOnEscape({
      key: 'Escape',
      isExpandedInput: true,
      isMobile: true,
    })).toBe(false);
    expect(shouldCollapseExpandedInputOnEscape({
      key: 'Escape',
      isExpandedInput: false,
    })).toBe(false);
  });

  test('yields to autocomplete and shell mode', () => {
    expect(shouldCollapseExpandedInputOnEscape({
      key: 'Escape',
      isExpandedInput: true,
      autocompleteOpen: true,
    })).toBe(false);
    expect(shouldCollapseExpandedInputOnEscape({
      key: 'Escape',
      isExpandedInput: true,
      inputMode: 'shell',
    })).toBe(false);
  });
});
