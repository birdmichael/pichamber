import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { isPiGoalComposerButtonVisible } from '@/lib/piGoal';
import { usePiKernel } from '@/lib/usePiKernel';
import { cn } from '@/lib/utils';
import { useInputStore } from '@/sync/input-store';
import { refreshFeaturePlugins, usePiFeaturePluginsStore } from '@/sync/pi-feature-plugins-store';

interface PiGoalButtonProps {
  sessionId: string | null;
  directory?: string;
  draftOpen?: boolean;
  footerIconButtonClass: string;
  iconSizeClass: string;
  withTooltip?: boolean;
}

export const PiGoalButton: React.FC<PiGoalButtonProps> = React.memo(({
  footerIconButtonClass,
  iconSizeClass,
  withTooltip = false,
}) => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const payload = usePiFeaturePluginsStore((state) => state.payload);

  React.useEffect(() => {
    if (!isPiKernel) return;
    void refreshFeaturePlugins();
  }, [isPiKernel]);

  if (!isPiKernel) {
    return null;
  }

  const showButton = isPiGoalComposerButtonVisible({ isPiKernel, payload });
  if (!showButton) return null;

  const label = t('chat.piGoal.buttonAria');

  const button = (
    <button
      type="button"
      className={footerIconButtonClass}
      onClick={() => {
        useInputStore.getState().requestOpenGoalDialog('');
      }}
      aria-label={label}
      {...(withTooltip ? {} : { title: label })}
    >
      <Icon name="target" className={cn(iconSizeClass, 'text-current')} aria-hidden="true" />
    </button>
  );

  return withTooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  ) : button;
});

PiGoalButton.displayName = 'PiGoalButton';
