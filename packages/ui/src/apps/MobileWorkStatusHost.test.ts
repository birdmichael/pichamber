import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { isWorkStatusSectionAvailable } from '@/components/chat/work-status/sections';
import { isMcpSettingsAvailable } from '@/lib/settings/metadata';
import { openSubagentChildSession } from '@/lib/subagents/childSession';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hostSource = readFileSync(join(__dirname, 'MobileWorkStatusHost.tsx'), 'utf-8');
const metadataSource = readFileSync(join(__dirname, 'MobileSessionMetadata.tsx'), 'utf-8');
const visibilitySource = readFileSync(
  join(__dirname, '../components/chat/work-status/useWorkStatusVisibility.ts'),
  'utf-8',
);
const chatContainerSource = readFileSync(
  join(__dirname, '../components/chat/ChatContainer.tsx'),
  'utf-8',
);

describe('MobileWorkStatusHost', () => {
  test('wraps Desktop Work Status sections and does not mount the chat-column card', () => {
    expect(hostSource).toContain('WorkStatusPrimaryGroup');
    expect(hostSource).toContain('WorkStatusGoalRow');
    expect(hostSource).toContain('WorkStatusMcpSection');
    expect(hostSource).toContain('WorkStatusSubagentsSection');
    expect(hostSource).toContain('WorkStatusTasksSection');
    expect(hostSource).toContain("isWorkStatusSectionVisible");
    expect(hostSource).toContain("sectionVisible('tasks')");
    expect(hostSource).not.toContain("from '@/components/chat/work-status/WorkStatusPanel'");
    expect(metadataSource).toContain('MobileWorkStatusHost');
    expect(metadataSource).not.toContain('UsageProviderCards');
    expect(visibilitySource).toContain('const layoutAllows = !isMobile && !isVSCode');
    expect(visibilitySource).toContain('WORK_STATUS_REQUIRED_ROW_WIDTH');
    expect(chatContainerSource).toContain('workStatusPanelMountable = !isMobile');
    expect(chatContainerSource).toContain('isManagedChatContext');
    expect(chatContainerSource).toContain('repositoryEnabled={!isManagedChatContext}');
    expect(chatContainerSource).toContain('useWorkStatusVisibility({');
    expect(chatContainerSource).not.toContain('directory: workStatusDirectory');
    expect(hostSource).toContain('repositoryEnabled && sectionVisible(\'repository\')');
    expect(metadataSource).toContain('repositoryEnabled={!isManagedChatContext}');
  });

  test('hides usage quotas on Pi until the Grok Usage slot is on', () => {
    expect(isWorkStatusSectionAvailable('usage', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('usage', { isPiKernel: true, xaiSlotActive: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('session', { isPiKernel: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('repository', { isPiKernel: true })).toBe(true);
    expect(hostSource).toContain("sectionVisible('usage')");
    expect(hostSource).toContain("useFeaturePluginSlotActive('xai'");
  });

  test('gates the MCP row on the same Feature Plugin slot as Settings MCP', () => {
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: false })).toBe(false);
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: true }))
      .toBe(isMcpSettingsAvailable({ isPiKernel: true, isMcpFeaturePluginActive: true }));
    expect(hostSource).toContain("sectionVisible('mcp')");
  });

  test('gates the Subagents row on the Feature Plugin Subagents slot', () => {
    expect(isWorkStatusSectionAvailable('subagents', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('subagents', { isPiKernel: true, subagentsSlotActive: false })).toBe(false);
    expect(isWorkStatusSectionAvailable('subagents', { isPiKernel: true, subagentsSlotActive: true })).toBe(true);
    expect(hostSource).toContain('useFeaturePluginSlotActive');
    expect(hostSource).toContain("sectionVisible('subagents')");
  });

  test('gates the Tasks row on the Feature Plugin Todo slot', () => {
    expect(isWorkStatusSectionAvailable('tasks', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('tasks', { isPiKernel: true, todoSlotActive: false })).toBe(false);
    expect(isWorkStatusSectionAvailable('tasks', { isPiKernel: true, todoSlotActive: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('tasks', { isPiKernel: false })).toBe(true);
    expect(hostSource).toContain("useFeaturePluginSlotActive('todo'");
    expect(hostSource).toContain("useFeaturePluginSlotActive('xai'");
    expect(hostSource).toContain("sectionVisible('tasks')");
    expect(hostSource.indexOf("{sectionVisible('tasks') ? <WorkStatusTasksSection"))
      .toBeLessThan(hostSource.indexOf('<WorkStatusPrimaryGroup'));
  });

  test('clicking a live child uses the existing in-place setCurrentSession helper', () => {
    const navigated: Array<[string, string]> = [];
    expect(openSubagentChildSession({
      sessionID: 'ses_child',
      directory: '/repo',
      label: 'scout',
      readOnly: false,
      isMobile: true,
      isVSCode: false,
      isEmbedded: false,
      setCurrentSession: (sessionID, directory) => navigated.push([sessionID, directory]),
      openContextPanelTab: () => {
        throw new Error('must not open a context-panel chat tab');
      },
    })).toBe(true);
    expect(navigated).toEqual([['ses_child', '/repo']]);
  });
});
