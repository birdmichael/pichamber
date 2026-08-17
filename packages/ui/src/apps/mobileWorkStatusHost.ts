import {
  getAvailableWorkStatusSectionIds,
  isWorkStatusSectionAvailable,
  type WorkStatusSectionContext,
  type WorkStatusSectionId,
} from '@/components/chat/work-status/sections';
import { isInlineWorkStatusPanelAllowed } from '@/components/chat/work-status/useWorkStatusVisibility';
import { isMcpSettingsAvailable } from '@/lib/settings/metadata';

/**
 * Touch host for Desktop Work Status rows.
 *
 * The 300px chat-column card stays desktop/web-only. `isMobile` refuses that
 * inline column (`isInlineWorkStatusPanelAllowed`); it does not hide the rows.
 * Hosted `mobile.html` and Capacitor open the same sections from the header
 * context ring (`MobileSessionMetadata`).
 */
export const MOBILE_WORK_STATUS_HOST = 'session-metadata' as const;

export const listMobileWorkStatusSectionIds = (
  context?: WorkStatusSectionContext,
): readonly WorkStatusSectionId[] => getAvailableWorkStatusSectionIds(context);

/** Same Feature Plugin MCP slot as Settings MCP / Desktop Work Status. */
export const isMobileWorkStatusMcpAvailable = (
  context: Pick<WorkStatusSectionContext, 'isPiKernel' | 'isMcpFeaturePluginActive'>,
): boolean => (
  isMcpSettingsAvailable({
    isPiKernel: Boolean(context.isPiKernel),
    isMcpFeaturePluginActive: context.isMcpFeaturePluginActive,
  })
  && isWorkStatusSectionAvailable('mcp', context)
);

/** Same Feature Plugin Subagents slot as Desktop Work Status. */
export const isMobileWorkStatusSubagentsAvailable = (
  context: Pick<WorkStatusSectionContext, 'isPiKernel' | 'subagentsSlotActive'>,
): boolean => isWorkStatusSectionAvailable('subagents', context);

export const isMobileInlineWorkStatusHidden = (isMobile: boolean): boolean => (
  !isInlineWorkStatusPanelAllowed({ isMobile, isVSCode: false })
);
