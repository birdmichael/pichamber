import React from 'react';

import { useCurrentSessionActivity } from '@/hooks/useSessionActivity';
import { usePiKernel } from '@/lib/usePiKernel';
import { refreshFeaturePlugins, usePiPlanPluginAvailable } from '@/sync/pi-feature-plugins-store';
import {
  canShowPiPlanToggle,
  planBuildAvailable,
  resolveFooterPlanSelected,
  sessionPlanCanDiscard,
  sessionPlanHasMarkdown,
  sessionPlanViewAvailable,
} from '@/sync/pi-session-plan';
import { refreshSessionPlan, useSessionPlan } from '@/sync/pi-session-plan-store';
import { useSessionUIStore } from '@/sync/session-ui-store';

export function usePiPlanChrome(sessionID?: string | null) {
  const isPiKernel = usePiKernel();
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const draftOpen = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const draftPlanSelected = useSessionUIStore((state) => state.newSessionDraft?.planSelected === true);
  const resolvedSessionId = sessionID ?? currentSessionId;
  const planPluginAvailable = usePiPlanPluginAvailable();
  const plan = useSessionPlan(resolvedSessionId);
  const { phase } = useCurrentSessionActivity();
  const busy = phase === 'busy' || phase === 'retry';
  const available = isPiKernel && planPluginAvailable;

  React.useEffect(() => {
    if (!isPiKernel) return;
    void refreshFeaturePlugins();
  }, [isPiKernel]);

  React.useEffect(() => {
    if (!available || !resolvedSessionId) return;
    void refreshSessionPlan(resolvedSessionId);
  }, [available, resolvedSessionId]);

  return {
    isPiKernel,
    available,
    sessionID: resolvedSessionId,
    draftOpen,
    plan,
    status: plan?.status ?? 'off',
    busy,
    showToggle: canShowPiPlanToggle(available, resolvedSessionId, draftOpen),
    footerPlanSelected: resolveFooterPlanSelected({
      available,
      status: plan?.status,
      sessionID: resolvedSessionId,
      draftOpen,
      draftPlanSelected,
    }),
    showBuildRow: available && planBuildAvailable(plan?.status) && sessionPlanHasMarkdown(plan),
    showViewPlan: available && sessionPlanViewAvailable(plan),
    canDiscard: available && sessionPlanCanDiscard(plan),
    implementing: plan?.status === 'implementing',
  };
}
