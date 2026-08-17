import React from 'react';

import { useMcpFeaturePluginActive, usePiKernel } from '@/lib/usePiKernel';
import { useFeaturePluginSlotActive } from '@/stores/useFeaturePluginSlotsStore';
import { useUIStore } from '@/stores/useUIStore';

import {
  areAllWorkStatusSectionsHidden,
  isWorkStatusSectionVisible,
  type WorkStatusSectionContext,
  type WorkStatusSectionId,
} from './sections';

export const useWorkStatusSectionVisibility = (): {
  sectionContext: WorkStatusSectionContext;
  sectionVisible: (sectionId: WorkStatusSectionId) => boolean;
  allSectionsHidden: boolean;
} => {
  const hiddenSections = useUIStore((state) => state.workStatusHiddenSections);
  const isPiKernel = usePiKernel();
  const isMcpFeaturePluginActive = useMcpFeaturePluginActive();
  const subagentsSlotActive = useFeaturePluginSlotActive('subagents', isPiKernel);
  const sectionContext = React.useMemo(
    () => ({ isPiKernel, isMcpFeaturePluginActive, subagentsSlotActive }),
    [isMcpFeaturePluginActive, isPiKernel, subagentsSlotActive],
  );
  const sectionVisible = React.useCallback(
    (sectionId: WorkStatusSectionId) =>
      isWorkStatusSectionVisible(hiddenSections, sectionId, sectionContext),
    [hiddenSections, sectionContext],
  );
  return {
    sectionContext,
    sectionVisible,
    allSectionsHidden: areAllWorkStatusSectionsHidden(hiddenSections, sectionContext),
  };
};
