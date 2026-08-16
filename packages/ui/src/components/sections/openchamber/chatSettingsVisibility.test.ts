import { describe, expect, test } from 'bun:test';
import { chatKernelSettings } from './chatSettingsVisibility';

describe('chatKernelSettings', () => {
  test('keeps Session Goal and omits Session Assist on Pi', () => {
    expect(chatKernelSettings(true)).toEqual(['sessionGoal']);
  });

  test('keeps Session Goal and Session Assist on OpenCode', () => {
    expect(chatKernelSettings(false)).toEqual(['sessionGoal', 'sessionAssist']);
  });
});
