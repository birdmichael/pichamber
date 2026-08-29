import { describe, expect, test } from 'bun:test';

import {
  EXPENSIVE_PAINT_PAUSE_CLASS,
  applyExpensivePaintPause,
  shouldPauseExpensivePaint,
} from './usePauseExpensivePaint';

describe('shouldPauseExpensivePaint', () => {
  test('keeps glass frosting while the document is visible', () => {
    expect(shouldPauseExpensivePaint({ visible: true })).toBe(false);
  });

  test('pauses expensive paint only when the document is hidden', () => {
    expect(shouldPauseExpensivePaint({ visible: false })).toBe(true);
  });
});

describe('applyExpensivePaintPause', () => {
  test('toggles the document class without inventing other chrome', () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle: (className: string, force: boolean) => {
          if (force) classes.add(className);
          else classes.delete(className);
        },
      },
    };

    applyExpensivePaintPause(root, true);
    expect(classes.has(EXPENSIVE_PAINT_PAUSE_CLASS)).toBe(true);
    applyExpensivePaintPause(root, false);
    expect(classes.has(EXPENSIVE_PAINT_PAUSE_CLASS)).toBe(false);
  });
});
