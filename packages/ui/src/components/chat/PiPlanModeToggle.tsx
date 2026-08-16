import React from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { usePiPlanChrome } from '@/hooks/usePiPlanChrome';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { planToggleAction } from '@/sync/pi-session-plan';
import { dispatchSessionPlanAction } from '@/sync/pi-session-plan-store';

export function PiPlanModeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const chrome = usePiPlanChrome();
  const [pending, setPending] = React.useState(false);

  if (!chrome.available || !chrome.sessionID) return null;

  const disabled = chrome.busy || pending;

  const select = async (side: 'agent' | 'plan') => {
    const action = planToggleAction(chrome.status, side);
    if (!action || !chrome.sessionID) return;
    setPending(true);
    try {
      const next = await dispatchSessionPlanAction(chrome.sessionID, action);
      if (!next) {
        toast.error(t('chat.piPlan.actionFailed'));
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
        aria-pressed={chrome.footerPlanSelected}
        disabled={disabled}
        onClick={() => void select('plan')}
      >
        {t('chat.piPlan.plan')}
      </Button>
    </div>
  );
}
