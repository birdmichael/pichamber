import React from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { usePiPlanChrome } from '@/hooks/usePiPlanChrome';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/useConfigStore';
import { presentPiExtensionUiNotify } from '@/sync/pi-extension-ui-store';
import { PLAN_MODE_ENABLED_NOTIFY, planToggleAction } from '@/sync/pi-session-plan';
import { dispatchSessionPlanAction } from '@/sync/pi-session-plan-store';
import { materializeOpenDraftSession } from '@/sync/session-ui-store';

export function PiPlanModeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const chrome = usePiPlanChrome();
  const currentProviderId = useConfigStore((state) => state.currentProviderId);
  const currentModelId = useConfigStore((state) => state.currentModelId);
  const currentAgentName = useConfigStore((state) => state.currentAgentName);
  const currentVariant = useConfigStore((state) => state.currentVariant);
  const [pending, setPending] = React.useState(false);

  if (!chrome.showToggle) return null;

  const disabled = chrome.busy || pending;

  const select = async (side: 'agent' | 'plan') => {
    // Plan side is `/plan start` (notify only). Bare `/plan` stays the
    // composer/slash launch menu and still queues a ctx.ui select card.
    const action = planToggleAction(chrome.status, side);
    if (!action) return;
    setPending(true);
    try {
      let sessionID = chrome.sessionID;
      if (!sessionID && chrome.draftOpen) {
        if (!currentProviderId || !currentModelId) {
          toast.error(t('chat.piPlan.actionFailed'));
          return;
        }
        const created = await materializeOpenDraftSession({
          providerID: currentProviderId,
          modelID: currentModelId,
          agent: currentAgentName,
          variant: currentVariant,
        });
        sessionID = created?.sessionId ?? null;
      }
      if (!sessionID) return;
      const next = await dispatchSessionPlanAction(sessionID, action);
      if (!next) {
        toast.error(t('chat.piPlan.actionFailed'));
        return;
      }
      if (action === 'start') {
        presentPiExtensionUiNotify({
          message: PLAN_MODE_ENABLED_NOTIFY,
          level: 'info',
        });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className={cn('flex items-center gap-0.5', className)}
      role="group"
      aria-label={t('chat.piPlan.toggleAria')}
    >
      <Button
        type="button"
        variant="chip"
        size="xs"
        className="normal-case"
        aria-pressed={!chrome.footerPlanSelected}
        disabled={disabled}
        onClick={() => void select('agent')}
      >
        {t('chat.piPlan.agent')}
      </Button>
      <Button
        type="button"
        variant="chip"
        size="xs"
        className="normal-case"
        aria-pressed={chrome.footerPlanSelected}
        disabled={disabled}
        onClick={() => void select('plan')}
      >
        {t('chat.piPlan.plan')}
      </Button>
    </div>
  );
}
