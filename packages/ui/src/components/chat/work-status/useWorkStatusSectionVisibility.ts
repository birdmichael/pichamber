import React from 'react';

import { useMcpFeaturePluginActive, usePiKernel } from '@/lib/usePiKernel';
import { useFeaturePluginSlotActive } from '@/stores/useFeaturePluginSlotsStore';
import { useUIStore } from '@/stores/useUIStore';

import {
  areAllWorkStatusSectionsHidden,
  isWorkStatusSectionVisible,
} from './sections';

export type WorkStatusSectionVisible = (
  sectionId: Parameters<typeof isWorkStatusSectionVisible>[1],
) => boolean;

/**
 * Shared visibility gates for Desktop Work Status and the mobile host.
 *
 * One hook so a Feature Plugin / hidden-section check cannot drift between
 * `WorkStatusPanel` and `MobileWorkStatusHost`.
 */
export const useWorkStatusSectionVisibility = (): {
  sectionVisible: WorkStatusSectionVisible;
  allSectionsHidden: boolean;
} => {
  const hiddenSections = useUIStore((state) => state.workStatusHiddenSections);
  const isPiKernel = usePiKernel();
  const isMcpFeaturePluginActive = useMcpFeaturePluginActive();
  const subagentsSlotActive = useFeaturePluginSlotActive('subagents', isPiKernel);
  const todoSlotActive = useFeaturePluginSlotActive('todo', isPiKernel);
  const xaiSlotActive = useFeaturePluginSlotActive('xai', isPiKernel);
  const kimiSlotActive = useFeaturePluginSlotActive('kimi', isPiKernel);
  const sectionContext = React.useMemo(
    () => ({ isPiKernel, isMcpFeaturePluginActive, subagentsSlotActive, todoSlotActive, xaiSlotActive, kimiSlotActive }),
    [isMcpFeaturePluginActive, isPiKernel, kimiSlotActive, subagentsSlotActive, todoSlotActive, xaiSlotActive],
  );
  const sectionVisible = React.useCallback<WorkStatusSectionVisible>(
    (sectionId) => isWorkStatusSectionVisible(hiddenSections, sectionId, sectionContext),
    [hiddenSections, sectionContext],
  );
  const allSectionsHidden = areAllWorkStatusSectionsHidden(hiddenSections, sectionContext);
  return { sectionVisible, allSectionsHidden };
};
