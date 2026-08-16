import { describe, expect, test } from 'bun:test';
import { chatKernelSettings } from './chatSettingsVisibility';

describe('chatKernelSettings', () => {
  test('hides Session Goal and Session Assist on Pi', () => {
    expect(chatKernelSettings(true)).toEqual([]);
  });

  test('keeps Session Goal and Session Assist on OpenCode', () => {
    expect(chatKernelSettings(false)).toEqual(['sessionGoal', 'sessionAssist']);
  });
});
