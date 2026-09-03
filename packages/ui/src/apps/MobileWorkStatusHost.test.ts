import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { isWorkStatusSectionAvailable } from '@/components/chat/work-status/sections';
import {
  isWorkStatusDismissExemptTarget,
  shouldCloseWorkStatusSheetOnNavigate,
} from '@/components/chat/work-status/workStatusDismiss';
import { isMcpSettingsAvailable } from '@/lib/settings/metadata';
import { openSubagentChildSession } from '@/lib/subagents/childSession';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hostSource = readFileSync(join(__dirname, 'MobileWorkStatusHost.tsx'), 'utf-8');
const metadataSource = readFileSync(join(__dirname, 'MobileSessionMetadata.tsx'), 'utf-8');
const bodySource = readFileSync(
  join(__dirname, '../components/chat/work-status/WorkStatusBody.tsx'),
  'utf-8',
);
const contentsSource = readFileSync(
  join(__dirname, '../components/chat/work-status/WorkStatusContents.tsx'),
  'utf-8',
);
const sectionVisibilitySource = readFileSync(
  join(__dirname, '../components/chat/work-status/useWorkStatusSectionVisibility.ts'),
  'utf-8',
);
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
    expect(hostSource).toContain('WorkStatusContents');
    expect(hostSource).not.toContain("from '@/components/chat/work-status/WorkStatusPanel'");
    expect(bodySource).toContain('WorkStatusPrimaryGroup');
    expect(bodySource).toContain('WorkStatusGoalRow');
    expect(bodySource).toContain('WorkStatusMcpSection');
    expect(bodySource).toContain('WorkStatusSubagentsSection');
    expect(bodySource).toContain('WorkStatusTasksSection');
    expect(bodySource).toContain('WorkStatusPinnedSection');
    expect(bodySource).toContain('WorkStatusContextSection');
    expect(bodySource).toContain("sectionVisible('tasks')");
    expect(bodySource).toContain("sectionVisible('pinned')");
    expect(bodySource).toContain("sectionVisible('contextSources')");
    expect(bodySource).toContain('repositoryEnabled && sectionVisible(\'repository\')');
    expect(contentsSource).toContain('WorkStatusSectionsDialog');
    expect(contentsSource).toContain('equalizer-2');
    expect(contentsSource).toContain('data-work-status-equalizer');
    expect(metadataSource).toContain('MobileWorkStatusHost');
    expect(metadataSource).not.toContain('UsageProviderCards');
    expect(visibilitySource).toContain('const layoutAllows = !isMobile && !isVSCode');
    expect(visibilitySource).toContain('WORK_STATUS_REQUIRED_ROW_WIDTH');
    expect(chatContainerSource).toContain('workStatusPanelMountable = !isMobile');
    expect(chatContainerSource).toContain('isManagedChatContext');
    expect(chatContainerSource).toContain('repositoryEnabled={!isManagedChatContext}');
    expect(chatContainerSource).toContain('useWorkStatusVisibility({');
    expect(chatContainerSource).not.toContain('directory: workStatusDirectory');
    expect(metadataSource).toContain('repositoryEnabled={!isManagedChatContext}');
  });

  test('hides usage quotas on Pi until the Grok or Kimi Usage slot is on', () => {
    expect(isWorkStatusSectionAvailable('usage', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('usage', { isPiKernel: true, xaiSlotActive: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('usage', { isPiKernel: true, kimiSlotActive: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('session', { isPiKernel: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('repository', { isPiKernel: true })).toBe(true);
    expect(bodySource).toContain("sectionVisible('usage')");
    expect(sectionVisibilitySource).toContain("useFeaturePluginSlotActive('xai'");
    expect(sectionVisibilitySource).toContain("useFeaturePluginSlotActive('kimi'");
  });

  test('gates the MCP row on the same Feature Plugin slot as Settings MCP', () => {
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: false })).toBe(false);
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: true }))
      .toBe(isMcpSettingsAvailable({ isPiKernel: true, isMcpFeaturePluginActive: true }));
    expect(bodySource).toContain("sectionVisible('mcp')");
  });

  test('gates the Subagents row on the Feature Plugin Subagents slot', () => {
    expect(isWorkStatusSectionAvailable('subagents', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('subagents', { isPiKernel: true, subagentsSlotActive: false })).toBe(false);
    expect(isWorkStatusSectionAvailable('subagents', { isPiKernel: true, subagentsSlotActive: true })).toBe(true);
    expect(sectionVisibilitySource).toContain('useFeaturePluginSlotActive');
    expect(bodySource).toContain("sectionVisible('subagents')");
  });

  test('gates the Tasks row on the Feature Plugin Todo slot', () => {
    expect(isWorkStatusSectionAvailable('tasks', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('tasks', { isPiKernel: true, todoSlotActive: false })).toBe(false);
    expect(isWorkStatusSectionAvailable('tasks', { isPiKernel: true, todoSlotActive: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('tasks', { isPiKernel: false })).toBe(true);
    expect(sectionVisibilitySource).toContain("useFeaturePluginSlotActive('todo'");
    expect(sectionVisibilitySource).toContain("useFeaturePluginSlotActive('xai'");
    expect(bodySource).toContain("sectionVisible('tasks')");
    expect(bodySource.indexOf("{sectionVisible('tasks') ? <WorkStatusTasksSection"))
      .toBeLessThan(bodySource.indexOf('<WorkStatusPrimaryGroup'));
    expect(bodySource.indexOf("sectionVisible('pinned')"))
      .toBeLessThan(bodySource.indexOf("sectionVisible('contextSources')"));
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

  test('closes the overlay when the session changes or the context panel opens', () => {
    expect(shouldCloseWorkStatusSheetOnNavigate({
      sessionIdWhenOpened: 'ses_parent',
      currentSessionId: 'ses_child',
      panelWasOpen: false,
      panelIsOpen: false,
    })).toBe(true);
    expect(shouldCloseWorkStatusSheetOnNavigate({
      sessionIdWhenOpened: 'ses_parent',
      currentSessionId: 'ses_parent',
      panelWasOpen: false,
      panelIsOpen: true,
    })).toBe(true);
    expect(shouldCloseWorkStatusSheetOnNavigate({
      sessionIdWhenOpened: 'ses_parent',
      currentSessionId: 'ses_parent',
      panelWasOpen: false,
      panelIsOpen: false,
    })).toBe(false);
    expect(metadataSource).toContain('shouldCloseWorkStatusSheetOnNavigate');
    expect(metadataSource).toContain('onNavigate={onClose}');
  });

  test('closeIfOutside does not fire while the sections dialog is open', () => {
    expect(isWorkStatusDismissExemptTarget(null, { sectionsDialogOpen: true })).toBe(true);
    expect(isWorkStatusDismissExemptTarget(null, { sectionsDialogOpen: false })).toBe(false);
    expect(metadataSource).toContain('isWorkStatusDismissExemptTarget');
    expect(metadataSource).toContain('sectionsDialogOpen');
    expect(readFileSync(
      join(__dirname, '../components/chat/work-status/workStatusDismiss.ts'),
      'utf-8',
    )).toContain('[data-slot="dialog-content"]');
  });
});
