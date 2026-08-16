import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui';
import { usePiPlanChrome } from '@/hooks/usePiPlanChrome';
import { useDeviceInfo } from '@/lib/device';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { presentPiExtensionUiNotify } from '@/sync/pi-extension-ui-store';
import { PLAN_MODE_ENABLED_NOTIFY, planToggleAction } from '@/sync/pi-session-plan';
import { dispatchSessionPlanAction } from '@/sync/pi-session-plan-store';
import { materializeOpenDraftSession } from '@/sync/session-ui-store';

const PLAN_SIDES = [
  { side: 'agent' as const, labelKey: 'chat.piPlan.agent' },
  { side: 'plan' as const, labelKey: 'chat.piPlan.plan' },
] as const;

export function PiPlanModeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const chrome = usePiPlanChrome();
  const currentProviderId = useConfigStore((state) => state.currentProviderId);
  const currentModelId = useConfigStore((state) => state.currentModelId);
  const currentAgentName = useConfigStore((state) => state.currentAgentName);
  const currentVariant = useConfigStore((state) => state.currentVariant);
  const { isMobile: deviceIsMobile } = useDeviceInfo();
  const uiIsMobile = useUIStore((state) => state.isMobile);
  const isMobile = deviceIsMobile || uiIsMobile;
  const [pending, setPending] = React.useState(false);

  if (!chrome.showToggle) return null;

  const disabled = chrome.busy || pending;
  const selectedSide = chrome.footerPlanSelected ? 'plan' : 'agent';
  const triggerLabel = selectedSide === 'plan' ? t('chat.piPlan.plan') : t('chat.piPlan.agent');

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="chip"
          size="xs"
          className={cn('normal-case', className)}
          aria-pressed={chrome.footerPlanSelected}
          aria-label={t('chat.piPlan.toggleAria')}
          disabled={disabled}
        >
          {triggerLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isMobile ? 'start' : 'end'}
        className="w-[min(180px,calc(100vw-2rem))]"
      >
        {PLAN_SIDES.map(({ side, labelKey }) => {
          const selected = selectedSide === side;
          return (
            <DropdownMenuItem
              key={side}
              className="typography-meta"
              disabled={disabled}
              onSelect={() => { void select(side); }}
            >
              <div className="flex items-center justify-between gap-2 w-full min-w-0">
                <span className="typography-meta font-medium normal-case text-foreground truncate min-w-0">
                  {t(labelKey)}
                </span>
                {selected && <Icon name="check" className="size-4 text-primary flex-shrink-0" />}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
