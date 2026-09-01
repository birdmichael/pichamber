import { describe, expect, test } from 'bun:test';

import { canAddModelToGroup, MAX_MODELS_PER_GROUP } from './multiRunLimits';

describe('canAddModelToGroup', () => {
  test('allows more than five models when the group cap is unlimited', () => {
    expect(MAX_MODELS_PER_GROUP).toBeUndefined();
    expect(canAddModelToGroup(0)).toBe(true);
    expect(canAddModelToGroup(5)).toBe(true);
    expect(canAddModelToGroup(12)).toBe(true);
  });
});
