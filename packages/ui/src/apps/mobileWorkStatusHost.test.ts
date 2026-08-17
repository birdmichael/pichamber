import { describe, expect, test } from 'bun:test';

import { isWorkStatusSectionAvailable } from '@/components/chat/work-status/sections';
import { isInlineWorkStatusPanelAllowed } from '@/components/chat/work-status/useWorkStatusVisibility';
import { isMcpSettingsAvailable } from '@/lib/settings/metadata';
import { openSubagentChildSession } from '@/lib/subagents/childSession';

import {
  isMobileInlineWorkStatusHidden,
  isMobileWorkStatusMcpAvailable,
  isMobileWorkStatusSubagentsAvailable,
  listMobileWorkStatusSectionIds,
  MOBILE_WORK_STATUS_HOST,
} from './mobileWorkStatusHost';

describe('mobile Work Status host', () => {
  test('replaces the old isMobile hide: inline card stays off, metadata host lists Desktop rows', () => {
    expect(MOBILE_WORK_STATUS_HOST).toBe('session-metadata');
    expect(isMobileInlineWorkStatusHidden(true)).toBe(true);
    expect(isMobileInlineWorkStatusHidden(false)).toBe(false);
    expect(isInlineWorkStatusPanelAllowed({ isMobile: true, isVSCode: false })).toBe(false);
    expect(isInlineWorkStatusPanelAllowed({ isMobile: false, isVSCode: false })).toBe(true);

    const piRows = listMobileWorkStatusSectionIds({ isPiKernel: true });
    expect(piRows).toContain('session');
    expect(piRows).toContain('repository');
    expect(piRows).not.toContain('usage');
    expect(piRows).not.toContain('mcp');
    expect(piRows).not.toContain('subagents');
  });

  test('gates the MCP row on the same Feature Plugin slot as Settings MCP', () => {
    expect(isMobileWorkStatusMcpAvailable({ isPiKernel: true })).toBe(false);
    expect(isMobileWorkStatusMcpAvailable({ isPiKernel: true, isMcpFeaturePluginActive: false })).toBe(false);
    expect(isMobileWorkStatusMcpAvailable({ isPiKernel: true, isMcpFeaturePluginActive: true })).toBe(true);
    expect(isMobileWorkStatusMcpAvailable({ isPiKernel: false, isMcpFeaturePluginActive: false })).toBe(true);

    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: true }))
      .toBe(isMcpSettingsAvailable({ isPiKernel: true, isMcpFeaturePluginActive: true }));
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: false }))
      .toBe(isMcpSettingsAvailable({ isPiKernel: true, isMcpFeaturePluginActive: false }));
    expect(listMobileWorkStatusSectionIds({
      isPiKernel: true,
      isMcpFeaturePluginActive: true,
    })).toContain('mcp');
  });

  test('gates the Subagents row on the Feature Plugin Subagents slot', () => {
    expect(isMobileWorkStatusSubagentsAvailable({ isPiKernel: true })).toBe(false);
    expect(isMobileWorkStatusSubagentsAvailable({ isPiKernel: true, subagentsSlotActive: false })).toBe(false);
    expect(isMobileWorkStatusSubagentsAvailable({ isPiKernel: true, subagentsSlotActive: true })).toBe(true);
    expect(isMobileWorkStatusSubagentsAvailable({ isPiKernel: false, subagentsSlotActive: false })).toBe(true);
    expect(listMobileWorkStatusSectionIds({
      isPiKernel: true,
      subagentsSlotActive: true,
    })).toContain('subagents');
  });

  test('clicking a live child uses the Desktop in-place navigation helper', () => {
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
        throw new Error('must not open a side panel');
      },
    })).toBe(true);
    expect(navigated).toEqual([['ses_child', '/repo']]);
  });
});
