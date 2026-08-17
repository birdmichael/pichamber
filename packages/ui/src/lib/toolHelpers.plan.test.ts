import { describe, expect, test } from 'bun:test';

import { dict as zhCnDict } from '@/lib/i18n/messages/zh-CN';
import { getToolMetadata, resolveToolDisplayName } from './toolHelpers';

describe('plan tool display names', () => {
  test('plan_mode_complete is known metadata, not title-cased snake_case', () => {
    const metadata = getToolMetadata('plan_mode_complete');
    expect(metadata.displayName).toBe('Plan mode complete');
    expect(metadata.displayNameKey).toBe('chat.tool.planModeComplete');
    expect(resolveToolDisplayName('plan_mode_complete')).toBe('Plan mode complete');
    expect(resolveToolDisplayName('plan_mode_complete', (key) => zhCnDict[key])).toBe(
      zhCnDict['chat.tool.planModeComplete'],
    );
    expect(resolveToolDisplayName('plan_mode_complete', (key) => zhCnDict[key])).not.toBe(
      'Plan mode complete',
    );
  });

  test('keeps plan_enter and plan_exit on i18n keys', () => {
    expect(getToolMetadata('plan_enter').displayNameKey).toBe('chat.tool.planEnter');
    expect(getToolMetadata('plan_exit').displayNameKey).toBe('chat.tool.planExit');
  });
});
