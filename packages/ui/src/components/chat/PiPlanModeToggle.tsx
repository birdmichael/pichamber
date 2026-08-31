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
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useUIStore } from '@/stores/useUIStore';
import { presentPiExtensionUiNotify } from '@/sync/pi-extension-ui-store';
import { PLAN_MODE_ENABLED_NOTIFY, applyPlanToggleSelect, decidePlanToggleSelect } from '@/sync/pi-session-plan';
import { dispatchSessionPlanAction } from '@/sync/pi-session-plan-store';
import { useSessionUIStore } from '@/sync/session-ui-store';

const PLAN_SIDES = [
  { side: 'agent' as const, labelKey: 'chat.piPlan.agent' },
  { side: 'plan' as const, labelKey: 'chat.piPlan.plan' },
] as const;

export function PiPlanModeToggle({
  className,
  onOpenChange,
}: {
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const chrome = usePiPlanChrome();
  const { isMobile: deviceIsMobile } = useDeviceInfo();
  const uiIsMobile = useUIStore((state) => state.isMobile);
  const isMobile = deviceIsMobile || uiIsMobile;
  const [pending, setPending] = React.useState(false);

  if (!chrome.showToggle) return null;

  const disabled = chrome.busy || pending;
  const selectedSide = chrome.footerPlanSelected ? 'plan' : 'agent';
  const triggerLabel = selectedSide === 'plan' ? t('chat.piPlan.plan') : t('chat.piPlan.agent');

  const select = async (side: 'agent' | 'plan') => {
    // Draft Plan is local composer intent. /plan start waits for send.
    // An open session still uses /plan start (notify only). Bare /plan stays
    // the composer/slash launch menu.
    const decision = decidePlanToggleSelect({
      sessionID: chrome.sessionID,
      draftOpen: chrome.draftOpen,
      status: chrome.status,
      side,
    });
    if (decision.kind === 'noop') return;
    if (decision.kind === 'draft-intent') {
      useSessionUIStore.getState().setDraftPlanSelected(decision.planSelected);
      if (decision.planSelected) {
        presentPiExtensionUiNotify({
          message: PLAN_MODE_ENABLED_NOTIFY,
          level: 'info',
        });
      }
      return;
    }

    setPending(true);
    try {
      const result = await applyPlanToggleSelect({
        sessionID: chrome.sessionID,
        draftOpen: chrome.draftOpen,
        status: chrome.status,
        side,
        setDraftPlanSelected: useSessionUIStore.getState().setDraftPlanSelected,
        dispatchSessionPlanAction,
      });
      if (result.kind === 'session-action-failed') {
        toast.error(t('chat.piPlan.actionFailed'));
        return;
      }
      if (result.kind === 'session-action' && result.action === 'start') {
        presentPiExtensionUiNotify({
          message: PLAN_MODE_ENABLED_NOTIFY,
          level: 'info',
        });
        const sessionID = chrome.sessionID;
        const directory = (sessionID
          ? useSessionUIStore.getState().getDirectoryForSession(sessionID)
          : null)
          || useDirectoryStore.getState().currentDirectory;
        if (directory) useUIStore.getState().openContextPlan(directory);
      }
    } catch {
      toast.error(t('chat.piPlan.actionFailed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="chip"
          size="xs"
          className={cn('pi-plan-mode-toggle normal-case', className)}
          aria-pressed={chrome.footerPlanSelected}
          aria-label={t('chat.piPlan.toggleAria')}
          disabled={disabled}
          // Block focus transfer so the tap does not dismiss the keyboard /
          // collapse the mobile composer (same guard as MobileModelButton).
          onMouseDown={(event) => event.preventDefault()}
          onPointerDownCapture={(event) => {
            if (event.pointerType === 'touch') event.preventDefault();
          }}
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
